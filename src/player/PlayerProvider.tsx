import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Track, tracks } from '../data/mock';

interface PlayerContextValue {
  track: Track;
  isPlaying: boolean;
  progress: number;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  // Dùng cho hiệu ứng kéo mini player vào dock
  dockRef: React.RefObject<View | null>;
  hoverDock: boolean;
  setHoverDock: (v: boolean) => void;
  emergeFrom: { cx: number; cy: number } | null;
  setEmergeFrom: (o: { cx: number; cy: number } | null) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hoverDock, setHoverDock] = useState(false);
  const [emergeFrom, setEmergeFrom] = useState<{ cx: number; cy: number } | null>(null);
  const dockRef = useRef<View>(null);

  const track = tracks[index];

  const goTo = useCallback((i: number) => {
    setIndex(((i % tracks.length) + tracks.length) % tracks.length);
    setProgress(0);
  }, []);

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => {
    if (progress > 3) setProgress(0);
    else goTo(index - 1);
  }, [goTo, index, progress]);
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => setProgress((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, [isPlaying]);

  useEffect(() => {
    if (progress >= track.duration) goTo(index + 1);
  }, [progress, track.duration, index, goTo]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      track, isPlaying, progress, togglePlay, next, prev,
      dockRef, hoverDock, setHoverDock, emergeFrom, setEmergeFrom,
    }),
    [track, isPlaying, progress, togglePlay, next, prev, hoverDock, emergeFrom]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}