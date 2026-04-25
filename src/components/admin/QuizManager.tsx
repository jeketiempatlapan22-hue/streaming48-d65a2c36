import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Trophy, Coins, Clock, Loader2, Square, Plus, X, Wand2 } from "lucide-react";

interface Quiz {
  id: string;
  source: string;
  theme: string | null;
  difficulty: string | null;
  question: string;
  answers: string[];
  max_winners: number;
  coin_reward: number;
  duration_seconds: number;
  status: string;
  started_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface Winner {
  id: string;
  quiz_id: string;
  username: string;
  rank: number;
  coins_awarded: number;
  answered_at: string;
}

interface AIQuestion {
  question: string;
  answers: string[];
}

const THEMES = ["Umum", "JKT48", "Musik", "Anime", "Trivia", "Olahraga", "Sejarah", "Sains"];

const QuizManager = () => {
  const { toast } = useToast();
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [history, setHistory] = useState<Quiz[]>([]);
  const [activeWinners, setActiveWinners] = useState<Winner[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Form state
  const [source, setSource] = useState<"manual" | "ai">("manual");
  const [question, setQuestion] = useState("");
  const [answersText, setAnswersText] = useState("");
  const [maxWinners, setMaxWinners] = useState(3);
  const [coinReward, setCoinReward] = useState(50);
  const [duration, setDuration] = useState(60);
  const [theme, setTheme] = useState("Umum");
  const [difficulty, setDifficulty] = useState<"mudah" | "sedang" | "sulit">("sedang");
  const [customPrompt, setCustomPrompt] = useState("");
  const [aiQuestions, setAIQuestions] = useState<AIQuestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    const { data: actives } = await supabase
      .from("live_quizzes")
      .select("*")
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1);
    const a = (actives?.[0] as Quiz) || null;
    setActiveQuiz(a);
    if (a) {
      const { data: w } = await supabase
        .from("quiz_winners").select("*").eq("quiz_id", a.id).order("rank");
      setActiveWinners((w as Winner[]) || []);
    } else {
      setActiveWinners([]);
    }
    const { data: hist } = await supabase
      .from("live_quizzes")
      .select("*")
      .in("status", ["ended", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory((hist as Quiz[]) || []);
  }, []);

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("quiz-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_quizzes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_winners" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  // Tick countdown + auto-end
  useEffect(() => {
    const tick = async () => {
      if (!activeQuiz?.ends_at) { setSecondsLeft(0); return; }
      const ms = new Date(activeQuiz.ends_at).getTime() - Date.now();
      const s = Math.max(0, Math.ceil(ms / 1000));
      setSecondsLeft(s);
      if (s === 0 && activeQuiz.status === "active") {
        await supabase.rpc("end_expired_quizzes");
        refresh();
      }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [activeQuiz, refresh]);

  const handleGenerate = async () => {
    setGenerating(true);
    setAIQuestions([]);
    try {
      const { data, error } = await supabase.functions.invoke("quiz-generate", {
        body: { theme, difficulty, count: 3, custom_prompt: customPrompt },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAIQuestions(data.questions || []);
      toast({ title: "Pertanyaan dihasilkan", description: `${data.questions?.length || 0} pertanyaan dibuat AI.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Gagal generate", description: e.message });
    } finally {
      setGenerating(false);
    }
  };

  const useAIQuestion = (q: AIQuestion) => {
    setQuestion(q.question);
    setAnswersText(q.answers.join(", "));
    setSource("ai");
    toast({ title: "Pertanyaan dimuat", description: "Edit jika perlu, lalu klik Mulai Quiz." });
  };

  const handleStart = async () => {
    const ans = answersText.split(",").map((x) => x.trim()).filter(Boolean);
    if (!question.trim() || ans.length === 0) {
      toast({ variant: "destructive", title: "Lengkapi data", description: "Pertanyaan dan minimal 1 jawaban wajib." });
      return;
    }
    if (activeQuiz) {
      toast({ variant: "destructive", title: "Quiz sedang aktif", description: "Akhiri dulu quiz yang berjalan." });
      return;
    }
    setStarting(true);
    try {
      const now = new Date();
      const ends = new Date(now.getTime() + duration * 1000);
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.from("live_quizzes").insert({
        source,
        theme: source === "ai" ? theme : null,
        difficulty: source === "ai" ? difficulty : null,
        question: question.trim(),
        answers: ans,
        max_winners: maxWinners,
        coin_reward: coinReward,
        duration_seconds: duration,
        status: "active",
        started_at: now.toISOString(),
        ends_at: ends.toISOString(),
        created_by: session?.user?.id,
      });
      if (error) throw error;
      // Reset form
      setQuestion(""); setAnswersText(""); setAIQuestions([]);
      toast({ title: "Quiz dimulai!", description: `Berjalan ${duration} detik.` });
      refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Gagal", description: e.message });
    } finally {
      setStarting(false);
    }
  };

  const handleEndEarly = async () => {
    if (!activeQuiz) return;
    const { error } = await supabase
      .from("live_quizzes")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", activeQuiz.id);
    if (error) {
      toast({ variant: "destructive", title: "Gagal", description: error.message });
    } else {
      toast({ title: "Quiz diakhiri" });
      refresh();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black flex items-center gap-2"><Trophy className="h-6 w-6 text-yellow-400" /> Live Quiz</h2>
        <p className="text-sm text-muted-foreground mt-1">Buat quiz live dengan hadiah koin otomatis untuk pemenang.</p>
      </div>

      {/* Active quiz panel */}
      {activeQuiz && (
        <Card className="border-primary/40 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Badge className="bg-green-500/20 text-green-400 border-green-500/40">
              ● QUIZ AKTIF
            </Badge>
            <div className="flex gap-2 text-xs">
              <Badge variant="outline"><Coins className="h-3 w-3 mr-1" />{activeQuiz.coin_reward} koin</Badge>
              <Badge variant="outline"><Trophy className="h-3 w-3 mr-1" />{activeWinners.length}/{activeQuiz.max_winners}</Badge>
              <Badge variant="outline" className={secondsLeft <= 10 ? "text-red-400 border-red-400" : ""}>
                <Clock className="h-3 w-3 mr-1" />{secondsLeft}s
              </Badge>
            </div>
          </div>
          <p className="font-bold">{activeQuiz.question}</p>
          <div className="text-xs text-muted-foreground">
            Jawaban valid: <span className="font-mono">{activeQuiz.answers.join(", ")}</span>
          </div>
          {activeWinners.length > 0 && (
            <div>
              <div className="text-xs font-bold mb-1">Pemenang:</div>
              <div className="flex flex-wrap gap-1">
                {activeWinners.map((w) => (
                  <Badge key={w.id} className="bg-yellow-400/20 text-yellow-300 border-yellow-400/40">
                    #{w.rank} {w.username} (+{w.coins_awarded})
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <Button variant="destructive" size="sm" onClick={handleEndEarly}>
            <Square className="h-3 w-3 mr-1" /> Akhiri Quiz
          </Button>
        </Card>
      )}

      {/* Form buat quiz */}
      {!activeQuiz && (
        <Card className="p-4 space-y-4">
          <h3 className="font-bold">Buat Quiz Baru</h3>
          <Tabs value={source} onValueChange={(v) => setSource(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual"><Plus className="h-4 w-4 mr-1" />Manual</TabsTrigger>
              <TabsTrigger value="ai"><Sparkles className="h-4 w-4 mr-1" />AI Generate</TabsTrigger>
            </TabsList>

            <TabsContent value="ai" className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Tema</Label>
                  <Select value={theme} onValueChange={setTheme}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {THEMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Tingkat Kesulitan</Label>
                  <Select value={difficulty} onValueChange={(v: any) => setDifficulty(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mudah">Mudah</SelectItem>
                      <SelectItem value="sedang">Sedang</SelectItem>
                      <SelectItem value="sulit">Sulit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Instruksi tambahan (opsional)</Label>
                <Input
                  placeholder="contoh: fokus pada lagu JKT48 era 2020+"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  maxLength={300}
                />
              </div>
              <Button onClick={handleGenerate} disabled={generating} className="w-full">
                {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                Generate Pertanyaan AI
              </Button>

              {aiQuestions.length > 0 && (
                <div className="space-y-2 mt-2">
                  <div className="text-xs font-bold">Pilih salah satu:</div>
                  {aiQuestions.map((q, i) => (
                    <div key={i} className="rounded-lg border p-2 space-y-1 hover:border-primary cursor-pointer" onClick={() => useAIQuestion(q)}>
                      <div className="text-sm font-medium">{q.question}</div>
                      <div className="text-xs text-muted-foreground">Jawaban: {q.answers.join(", ")}</div>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]">Gunakan</Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="manual" className="space-y-2 mt-4">
              <div className="text-xs text-muted-foreground">Tulis pertanyaan dan jawaban Anda sendiri.</div>
            </TabsContent>
          </Tabs>

          <div className="space-y-3 pt-2 border-t">
            <div>
              <Label className="text-xs">Pertanyaan</Label>
              <Textarea
                placeholder="Siapa kapten JKT48 saat ini?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={300}
                rows={2}
              />
            </div>
            <div>
              <Label className="text-xs">Jawaban valid (pisah dengan koma)</Label>
              <Input
                placeholder="contoh: Shani, Shani JKT48, shani indira"
                value={answersText}
                onChange={(e) => setAnswersText(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Pencocokan tidak case-sensitive. Tambahkan variasi penulisan untuk fleksibilitas.</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Pemenang</Label>
                <Input type="number" min={1} max={20} value={maxWinners} onChange={(e) => setMaxWinners(Math.max(1, Math.min(20, +e.target.value || 1)))} />
              </div>
              <div>
                <Label className="text-xs">Koin/orang</Label>
                <Input type="number" min={1} max={10000} value={coinReward} onChange={(e) => setCoinReward(Math.max(1, Math.min(10000, +e.target.value || 1)))} />
              </div>
              <div>
                <Label className="text-xs">Durasi (detik)</Label>
                <Select value={String(duration)} onValueChange={(v) => setDuration(+v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30s</SelectItem>
                    <SelectItem value="60">60s</SelectItem>
                    <SelectItem value="120">2 menit</SelectItem>
                    <SelectItem value="300">5 menit</SelectItem>
                    <SelectItem value="600">10 menit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleStart} disabled={starting} className="w-full" size="lg">
              {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Mulai Quiz ({coinReward * maxWinners} koin total)
            </Button>
          </div>
        </Card>
      )}

      {/* History */}
      <Card className="p-4">
        <h3 className="font-bold mb-3">Riwayat Quiz</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada quiz selesai.</p>
        ) : (
          <div className="space-y-2">
            {history.map((q) => (
              <div key={q.id} className="rounded-lg border p-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge variant={q.status === "ended" ? "default" : "secondary"}>{q.status}</Badge>
                  <span className="text-[10px] text-muted-foreground">{new Date(q.created_at).toLocaleString("id-ID")}</span>
                </div>
                <p className="font-medium">{q.question}</p>
                <p className="text-xs text-muted-foreground">
                  {q.coin_reward} koin × {q.max_winners} pemenang • {q.source === "ai" ? `AI ${q.theme}/${q.difficulty}` : "Manual"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default QuizManager;
