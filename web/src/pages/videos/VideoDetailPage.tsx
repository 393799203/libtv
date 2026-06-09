import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Button,
  Avatar,
} from 'antd';
import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  MoreOutlined,
  HeartOutlined,
  MessageOutlined,
  ShareAltOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  PlusOutlined,
  SoundOutlined,
  MutedOutlined,
} from '@ant-design/icons';
import { videoApi } from '@/services/videoApi';
import type { Video } from '@/types/video';

const { Text } = Typography;

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [videoInfo, setVideoInfo] = useState<Video | null>(null);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingRef = useRef(false);

  // 从 API 获取视频详情
  useEffect(() => {
    if (!id) return;
    videoApi.getVideo(id).then((data) => {
      if (data) setVideoInfo(data);
    });
  }, [id]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoInfo?.videoUrl) return;

    const syncDuration = () => {
      if (video.readyState >= 1 && video.duration > 0 && isFinite(video.duration)) {
        setDuration(video.duration);
        setIsVideoLoaded(true);
      }
    };

    syncDuration();

    const onLoadedMetadata = () => {
      if (video.duration > 0 && isFinite(video.duration)) {
        setDuration(video.duration);
        setIsVideoLoaded(true);
      }
    };
    const onDurationChange = () => {
      if (video.duration > 0 && isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('durationchange', onDurationChange);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('durationchange', onDurationChange);
    };
  }, [videoInfo?.videoUrl]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      const d = videoRef.current.duration;
      if (d > 0 && isFinite(d)) {
        setDuration(d);
      }
    }
  };

  const handleSeek = (value: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = value;
      setCurrentTime(value);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const handleProgress = () => {
    if (videoRef.current && videoRef.current.duration > 0) {
      let bufferedEnd = 0;
      if (videoRef.current.buffered.length > 0) {
        bufferedEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      }
      setBuffered(bufferedEnd / videoRef.current.duration);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    hideControlsTimeout.current = setTimeout(() => {
      if (isPlayingRef.current) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, []);

  if (!videoInfo) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen bg-black relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* 全屏视频区域 */}
      <div className="w-full h-screen flex items-center justify-center bg-black relative">
        {videoInfo ? (
          <video
            ref={videoRef}
            src={videoInfo.videoUrl}
            className="w-full h-full object-cover"
            loop
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
            onProgress={handleProgress}
            onPlay={() => { setIsPlaying(true); isPlayingRef.current = true; }}
            onPause={() => { setIsPlaying(false); isPlayingRef.current = false; }}
            onClick={togglePlay}
          />
        ) : (
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
        )}
        {/* 加载指示器 */}
        {!isPlaying && !isVideoLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
          </div>
        )}
      </div>

      {/* 视频控制遮罩 */}
      <div
        className="absolute inset-0 cursor-pointer z-20"
        onClick={togglePlay}
      >
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <PlayCircleOutlined style={{ fontSize: '64px', color: 'white' }} />
            </div>
          </div>
        )}
      </div>

      {/* 顶部导航 */}
      <div 
        className={`absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined style={{ color: 'white', fontSize: '24px' }} />}
          onClick={() => navigate(-1)}
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', border: 'none', color: 'white' }}
        />
        <Button
          type="text"
          icon={<MoreOutlined style={{ color: 'white', fontSize: '24px' }} />}
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', border: 'none', color: 'white' }}
        />
      </div>

      {/* 右侧交互按钮（抖音风格） */}
      <div 
        className={`absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-6 z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* 作者头像 */}
        <div className="flex flex-col items-center">
          <div className="relative">
            <Avatar size={48} src={videoInfo.authorAvatar} style={{ border: '2px solid white' }} />
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
              <PlusOutlined style={{ fontSize: '12px', color: 'white' }} />
            </div>
          </div>
        </div>

        {/* 点赞 */}
        <div className="flex flex-col items-center">
          <Button
            type="text"
            icon={<HeartOutlined style={{ fontSize: '32px', color: 'white' }} />}
            style={{ color: 'white', border: 'none', padding: 0 }}
          />
          <Text style={{ color: 'white', fontSize: '12px', marginTop: '4px' }}>{videoInfo.stats.likes}</Text>
        </div>

        {/* 评论 */}
        <div className="flex flex-col items-center">
          <Button
            type="text"
            icon={<MessageOutlined style={{ fontSize: '32px', color: 'white' }} />}
            style={{ color: 'white', border: 'none', padding: 0 }}
          />
          <Text style={{ color: 'white', fontSize: '12px', marginTop: '4px' }}>{videoInfo.stats.comments}</Text>
        </div>

        {/* 分享 */}
        <div className="flex flex-col items-center">
          <Button
            type="text"
            icon={<ShareAltOutlined style={{ fontSize: '32px', color: 'white' }} />}
            style={{ color: 'white', border: 'none', padding: 0 }}
          />
          <Text style={{ color: 'white', fontSize: '12px', marginTop: '4px' }}>分享</Text>
        </div>
      </div>

      {/* 底部控制条 */}
      <div 
        className={`absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="px-6 pb-4 bg-gradient-to-t from-black/90 to-transparent">
          <div className="mb-2">
            {/* 自定义进度条 */}
            <div 
              className="relative h-1.5 bg-white/30 rounded-full cursor-pointer group"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const percentage = clickX / rect.width;
                if (videoRef.current && duration) {
                  handleSeek(percentage * duration);
                }
              }}
            >
              {/* 缓冲进度 */}
              <div 
                className="absolute top-0 left-0 h-full bg-white/40 rounded-full"
                style={{ width: `${Math.min(Math.max(buffered * 100, 0), 100)}%`, zIndex: 1 }}
              />
              {/* 播放进度 */}
              <div 
                className="absolute top-0 left-0 h-full bg-white rounded-full"
                style={{ width: `${Math.min(Math.max((currentTime / duration) * 100, 0), 100)}%`, zIndex: 2 }}
              />
              {/* 滑块 */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${Math.min(Math.max((currentTime / duration) * 100, 0), 100)}%`, marginLeft: '-7px', zIndex: 3 }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-white">
              <Button
                type="text"
                icon={isPlaying ? <PauseCircleOutlined style={{ fontSize: '24px' }} /> : <PlayCircleOutlined style={{ fontSize: '24px' }} />}
                onClick={togglePlay}
                style={{ color: 'white', border: 'none', padding: 0 }}
              />
              <span style={{ fontSize: '12px' }}>{formatTime(currentTime)} / {formatTime(duration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="text"
                icon={isMuted ? <MutedOutlined style={{ fontSize: '20px' }} /> : <SoundOutlined style={{ fontSize: '20px' }} />}
                onClick={toggleMute}
                style={{ color: 'white', border: 'none', padding: 0 }}
              />
              <Button
                type="text"
                icon={isFullscreen ? <FullscreenExitOutlined style={{ fontSize: '20px' }} /> : <FullscreenOutlined style={{ fontSize: '20px' }} />}
                onClick={toggleFullscreen}
                style={{ color: 'white', border: 'none', padding: 0 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
