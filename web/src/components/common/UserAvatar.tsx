import { useEffect, useState, type CSSProperties } from 'react';
import { avatarRequestSrc, getUserAvatarSrc } from '@/utils/avatar';
import './userAvatar.css';

interface UserAvatarProps {
  src?: string | null;
  name?: string;
  alt?: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
  loading?: 'lazy' | 'eager';
}

export function UserAvatar(props: UserAvatarProps) {
  const source = props.src?.trim() || '';
  // A changed photo starts a fresh request; old failures/timers cannot hide it.
  return <AvatarImage key={source} {...props} src={source} />;
}

function AvatarImage({ src = '', name, alt = '', className = '', size, style, loading }: UserAvatarProps) {
  const source = src || '';
  const [attempt, setAttempt] = useState(0);
  const [loadedSource, setLoadedSource] = useState('');
  const [failed, setFailed] = useState(false);
  const [retryKey] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const imageSource = avatarRequestSrc(source, attempt, retryKey);
  const fallback = getUserAvatarSrc({ nickname: name });

  useEffect(() => {
    if (!failed) return;
    const retry = () => {
      if (navigator.onLine === false || document.visibilityState === 'hidden') return;
      setFailed(false);
      setAttempt(value => Math.min(4, value + 1));
    };
    // Two automatic retries; after that, allow at most two recovery attempts
    // when connectivity or tab focus returns. Never poll a missing file.
    const timer = attempt < 2 ? window.setTimeout(retry, attempt === 0 ? 1000 : 3000) : undefined;
    const recover = () => { if (attempt < 4) retry(); };
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('online', recover);
      window.removeEventListener('focus', recover);
    };
  }, [failed, attempt]);

  return (
    <span className={`user-avatar ${className}`} role={alt ? 'img' : undefined}
      aria-label={alt || undefined} aria-hidden={!alt || undefined}
      data-avatar-state={!source ? 'fallback' : loadedSource === imageSource && !failed ? 'loaded' : failed ? 'failed' : 'loading'}
      style={{
        backgroundImage: `url("${fallback}")`,
        ...(size ? { width: size, height: size } : {}),
        ...style,
      }}>
      {source && <img key={`${attempt}-${imageSource}`} src={imageSource} alt="" aria-hidden="true"
        loading={loading} decoding="async" draggable={false}
        style={{ opacity: loadedSource === imageSource && !failed ? 1 : 0 }}
        onLoad={() => { setLoadedSource(imageSource); setFailed(false); }}
        onError={event => {
          event.currentTarget.style.opacity = '0';
          setLoadedSource('');
          setFailed(true);
        }} />}
    </span>
  );
}
