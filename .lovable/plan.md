

## Plan: Proteksi Overlay YouTube Player

### Masalah
Overlay transparan saat ini (`z-10`) hanya menangkap klik biasa, tetapi tombol YouTube asli (play, share, logo, title link) masih bisa diklik karena:
1. Overlay hanya `background: transparent` — pointer events bisa "tembus" di beberapa browser
2. Fallback iframe (`controls=0`) masih memungkinkan interaksi jika overlay gagal
3. Tidak ada proteksi ganda untuk mencegah user menemukan sumber YouTube

### Perubahan di `src/components/VideoPlayer.tsx`

#### 1. Perkuat Overlay YouTube (API Player & Fallback)
- Tambahkan **dua layer overlay** di atas iframe YouTube:
  - Layer 1: `div` dengan `z-10`, `pointer-events: all`, `background: rgba(0,0,0,0.001)` — cukup opaque agar browser tidak meneruskan klik ke iframe, tapi tidak terlihat oleh mata
  - Layer 2: `div` dengan `z-11` yang **hanya** untuk area tombol kontrol custom (play/pause, mute, dll)
- Overlay menutupi **seluruh** area iframe termasuk pojok (logo YouTube, title, share)
- `onContextMenu` dan `onDragStart` tetap di-block

#### 2. Tambahkan `origin` Parameter ke YouTube
- API player: tambah `origin: window.location.origin` di `playerVars` untuk mencegah error cross-origin
- Fallback iframe: tambah `&origin=` di URL

#### 3. YouTube Fallback Iframe — Tetap `controls=0`
- Pertahankan `controls=0` dan `enablejsapi=0` di fallback iframe
- Overlay ganda sudah memastikan tombol YouTube tidak bisa diklik

#### 4. Pastikan Iframe Tidak Bisa Diakses via DevTools
- Tambahkan `tabindex="-1"` pada iframe YouTube agar tidak bisa di-focus via Tab key
- Tambahkan `aria-hidden="true"` untuk menyembunyikan dari accessibility tree

### Detail Teknis

```tsx
{/* YouTube API Player */}
{playlistType === "youtube" && !ytFallback && (
  <div className="relative w-full h-full absolute inset-0">
    <div ref={ytContainerRef} className="absolute inset-0 ..." />
    {/* Full blocking overlay — prevents ALL clicks to YouTube iframe */}
    <div 
      className="absolute inset-0 z-10 cursor-pointer"
      style={{ background: "rgba(0,0,0,0.001)", pointerEvents: "all" }}
      onContextMenu={e => e.preventDefault()}
      onDragStart={e => e.preventDefault()}
      onClick={e => { e.stopPropagation(); togglePlay(e); }}
      onDoubleClick={e => { e.stopPropagation(); e.preventDefault(); }}
      onTouchStart={e => e.stopPropagation()}
    />
  </div>
)}
```

Juga di `createProtectedIframe`:
```typescript
iframe.setAttribute("tabindex", "-1");
iframe.setAttribute("aria-hidden", "true");
iframe.style.pointerEvents = "none"; // iframe itself receives no clicks
```

### File yang Diubah

| File | Perubahan |
|------|-----------|
| `src/components/VideoPlayer.tsx` | Perkuat overlay, `pointerEvents: "none"` pada iframe, `origin` param, `tabindex`/`aria-hidden` |

