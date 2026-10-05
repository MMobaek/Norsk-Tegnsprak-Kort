import { useEffect, useRef } from 'react';

interface Props {
  src: string;
  muted?: boolean;
  loop?: boolean;
  speed: number;
  className?: string;
}

export default function VideoPlayer({
  src,
  muted = true,
  loop = true,
  speed,
  className
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (v) v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = ref.current;
    if (v) v.loop = loop;
  }, [loop]);

  return (
    <video
      ref={ref}
      className={className ?? 'max-h-[46vh] w-auto max-w-full rounded-xl bg-black shadow-md'}
      src={src}
      autoPlay
      playsInline
      muted={muted}
      loop={loop}
      controls
      preload="auto"
      onClick={(e) => {
        const v = e.currentTarget;
        if (v.paused) void v.play();
        else v.pause();
      }}
    />
  );
}
