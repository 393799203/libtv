import { useEffect, useRef, useState } from 'react';
import { PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';

const VIDEO = '/auth/auth-town-7700299900935884095.mp4';
const POSTER = '/auth/auth-town-7700299900935884095.jpg';
const MOTION_QUERY = '(min-width: 900px) and (prefers-reduced-motion: no-preference)';

/** 视频只在桌面认证页加载；隐藏页面和用户暂停时停止播放。 */
export function AuthBackgroundVideo() {
  const [enabled, setEnabled] = useState(() => window.matchMedia(MOTION_QUERY).matches);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const active = enabled && !failed;

  useEffect(() => {
    const media = window.matchMedia(MOTION_QUERY);
    const onChange = () => setEnabled(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    let disposed = false;
    const syncPlayback = () => {
      if (paused || document.hidden) video.pause();
      else {
        video.muted = true;
        void video.play().catch(error => {
          if (error?.name === 'AbortError') return;
          if (!disposed) { setPaused(true); setLoading(false); }
        });
      }
    };
    syncPlayback();
    document.addEventListener('visibilitychange', syncPlayback);
    return () => {
      disposed = true;
      video.pause();
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, [active, paused]);

  return <>
    <img className="auth-page-scene-media" src={POSTER} alt="" loading="lazy" decoding="async" />
    {active && <video ref={videoRef} className="auth-page-scene-media"
      src={VIDEO} poster={POSTER} muted loop playsInline preload="metadata"
      aria-hidden="true"
      onLoadStart={() => setLoading(true)}
      onCanPlay={() => setLoading(false)}
      onPlaying={() => setLoading(false)}
      onWaiting={() => setLoading(true)}
      onError={() => setFailed(true)} />}
    {active && loading && <div className="auth-page-video-loading" role="status" aria-live="polite">
      <span className="auth-page-video-loading-ring" aria-hidden="true" />
      <span>视频加载中…</span>
    </div>}
    {active && <button type="button" className="auth-page-video-toggle"
      aria-label={paused ? '播放背景视频' : '暂停背景视频'}
      onClick={() => {
        const video = videoRef.current;
        if (!video) return;
        if (paused) {
          void video.play().then(() => setPaused(false)).catch(() => setPaused(true));
        } else {
          video.pause();
          setPaused(true);
          setLoading(false);
        }
      }}>
      {paused ? <PlayCircleOutlined /> : <PauseOutlined />}
    </button>}
  </>;
}
