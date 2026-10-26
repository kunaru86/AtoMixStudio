import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, Pause, Sliders, Music, X, Clock, Zap, Trash, Plus, Sparkles, AlertTriangle, Cpu, Disc, RefreshCw, Volume2 
} from 'lucide-react';

export interface Keyframe {
  id: string;
  time: number; // in seconds
  value: number; // raw value
}

export interface TimelineTrack {
  id: string;
  name: string; // "Scale", "Chaos Density", "Displacement", "Rotation Speed", "Crossfader", "Deck A Volume", "Deck B Volume", "Visualizer Mode", "Palette Mood"
  min: number;
  max: number;
  defaultValue: number;
  keyframes: Keyframe[];
  type: 'analog' | 'discrete'; // analog is interpolated, discrete jumps
}

export interface ActiveTimeline {
  isPlaying: boolean;
  time: number;
  duration: number; // in seconds, e.g. 30s or 60s
  bpm: number;
  loop: boolean;
  audioSync: boolean; // if true, playhead is locked to Deck A's audio currentTime
  tracks: TimelineTrack[];
}

interface MasterTimelineProps {
  timeline: ActiveTimeline;
  setTimeline: React.Dispatch<React.SetStateAction<ActiveTimeline>>;
  timelineRef: React.MutableRefObject<ActiveTimeline>;
  vjState: any;
  updateVjSetting: (key: string, value: any) => void;
  engine: any;
  queue: any[];
}

// Keyframes generator helper
const createKeyframe = (time: number, value: number): Keyframe => ({
  id: `kf-${Math.random().toString(36).substr(2, 9)}`,
  time: Math.round(time * 100) / 100,
  value: Math.round(value * 100) / 100
});

export default function MasterTimeline({
  timeline,
  setTimeline,
  timelineRef,
  vjState,
  updateVjSetting,
  engine,
  queue
}: MasterTimelineProps) {
  const [activeTrackId, setActiveTrackId] = useState<string>('track-scale');
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentTimeLocal, setCurrentTimeLocal] = useState<number>(0);
  
  const svgRef = useRef<SVGSVGElement>(null);
  const isDraggingKeyframeRef = useRef<boolean>(false);

  // Sync internal local time state for scrubber indicator
  useEffect(() => {
    const handleTimeTick = () => {
      setCurrentTimeLocal(timelineRef.current.time);
    };
    const interval = setInterval(handleTimeTick, 33); // ~30fps UI update
    return () => clearInterval(interval);
  }, [timelineRef]);

  // Find active track details
  const activeTrack = useMemo(() => {
    return timeline.tracks.find(t => t.id === activeTrackId);
  }, [timeline.tracks, activeTrackId]);

  // Help calculate interpolated or discrete value at the current time
  const getInterpolatedValueAtTime = (track: TimelineTrack, t: number) => {
    const kfs = [...track.keyframes].sort((a, b) => a.time - b.time);
    if (kfs.length === 0) return track.defaultValue;
    if (t <= kfs[0].time) return kfs[0].value;
    if (t >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

    // Find bounding keyframes
    for (let i = 0; i < kfs.length - 1; i++) {
      if (t >= kfs[i].time && t <= kfs[i + 1].time) {
        if (track.type === 'discrete') {
          return kfs[i].value;
        }
        const pct = (t - kfs[i].time) / (kfs[i + 1].time - kfs[i].time);
        return kfs[i].value + pct * (kfs[i + 1].value - kfs[i].time === 0 ? 0 : kfs[i + 1].value - kfs[i].value);
      }
    }
    return track.defaultValue;
  };

  // Human readable representations for discrete tracks
  const getDiscreteLabel = (trackId: string, val: number) => {
    const floorVal = Math.floor(val);
    if (trackId === 'track-viz') {
      const modeNames = ['Wave', 'Circular', 'Spiral', 'D3 Grid', 'Freq Rings', 'Chaos Boids', 'Webcam Grid', 'Shader Plane', 'Shader Bulb'];
      return modeNames[floorVal] || `Mode ${floorVal}`;
    }
    if (trackId === 'track-mood') {
      const moodNames = ['VIBRANT', 'NEON', 'PASTEL', 'MOODY'];
      return moodNames[floorVal] || 'VIBRANT';
    }
    return val.toFixed(1);
  };

  // Core update helper
  const updateTimelineConfig = (updates: Partial<ActiveTimeline>) => {
    setTimeline(prev => {
      const next = { ...prev, ...updates };
      timelineRef.current = next;
      return next;
    });
  };

  const updateTrackKeyframes = (trackId: string, newKeyframes: Keyframe[]) => {
    setTimeline(prev => {
      const next = {
        ...prev,
        tracks: prev.tracks.map(t => t.id === trackId ? { ...t, keyframes: newKeyframes.sort((a,b) => a.time - b.time) } : t)
      };
      timelineRef.current = next;
      return next;
    });
  };

  // Interactive Click/Drag on Timeline Workspace
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!activeTrack || isDraggingKeyframeRef.current || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate time from coordinates
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 20;
    const graphWidth = rect.width - paddingLeft - paddingRight;
    const graphHeight = rect.height - paddingTop - paddingBottom;

    if (x >= paddingLeft && x <= rect.width - paddingRight) {
      const normX = (x - paddingLeft) / graphWidth;
      const clickedTime = normX * timeline.duration;

      const normY = 1 - (y - paddingTop) / graphHeight;
      const clickedValue = activeTrack.min + normY * (activeTrack.max - activeTrack.min);

      // Check if we hit an existing keyframe first (within 8px range)
      const hitRadius = 10;
      let existingHitId: string | null = null;

      activeTrack.keyframes.forEach(kf => {
        const kfX = paddingLeft + (kf.time / timeline.duration) * graphWidth;
        const kfY = paddingTop + (1 - (kf.value - activeTrack.min) / (activeTrack.max - activeTrack.min)) * graphHeight;
        const dSq = (x - kfX) ** 2 + (y - kfY) ** 2;
        if (dSq < hitRadius * hitRadius) {
          existingHitId = kf.id;
        }
      });

      if (existingHitId) {
        setSelectedKeyframeId(existingHitId);
      } else {
        // Add a new keyframe node
        const boundedTime = Math.max(0, Math.min(timeline.duration, clickedTime));
        const boundedValue = Math.max(activeTrack.min, Math.min(activeTrack.max, clickedValue));
        const newKf = createKeyframe(boundedTime, boundedValue);
        const nextKeyframes = [...activeTrack.keyframes, newKf];
        updateTrackKeyframes(activeTrack.id, nextKeyframes);
        setSelectedKeyframeId(newKf.id);
      }
    }
  };

  const handleKeyframeMouseDown = (e: React.MouseEvent, kf: Keyframe) => {
    e.stopPropagation();
    setSelectedKeyframeId(kf.id);
    isDraggingKeyframeRef.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!svgRef.current || !activeTrack) return;
      const rect = svgRef.current.getBoundingClientRect();
      const paddingLeft = 40;
      const paddingRight = 20;
      const paddingTop = 20;
      const paddingBottom = 20;
      const graphWidth = rect.width - paddingLeft - paddingRight;
      const graphHeight = rect.height - paddingTop - paddingBottom;

      const x = moveEvent.clientX - rect.left;
      const y = moveEvent.clientY - rect.top;

      const normX = Math.max(0, Math.min(1, (x - paddingLeft) / graphWidth));
      const nextTime = normX * timeline.duration;

      const normY = Math.max(0, Math.min(1, 1 - (y - paddingTop) / graphHeight));
      const nextValue = activeTrack.min + normY * (activeTrack.max - activeTrack.min);

      const updatedKeyframes = activeTrack.keyframes.map(k => {
        if (k.id === kf.id) {
          return {
            ...k,
            time: Math.round(nextTime * 100) / 100,
            value: Math.round(nextValue * 100) / 100
          };
        }
        return k;
      });

      updateTrackKeyframes(activeTrack.id, updatedKeyframes);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setTimeout(() => {
        isDraggingKeyframeRef.current = false;
      }, 50);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const deleteSelectedKeyframe = () => {
    if (!activeTrack || !selectedKeyframeId) return;
    const nextKeyframes = activeTrack.keyframes.filter(k => k.id !== selectedKeyframeId);
    updateTrackKeyframes(activeTrack.id, nextKeyframes);
    setSelectedKeyframeId(null);
  };

  // Draw lines path
  const linePathMarkup = useMemo(() => {
    if (!activeTrack || activeTrack.keyframes.length === 0) return '';
    const sorted = [...activeTrack.keyframes].sort((a,b) => a.time - b.time);
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 20;

    // Get dummy values or mock dimensions to calculate on load, fallback to 600x180
    const w = 840;
    const h = 200;
    const graphWidth = w - paddingLeft - paddingRight;
    const graphHeight = h - paddingTop - paddingBottom;

    let path = `M `;
    sorted.forEach((kf, idx) => {
      const xCoord = paddingLeft + (kf.time / timeline.duration) * graphWidth;
      const yCoord = paddingTop + (1 - (kf.value - activeTrack.min) / (activeTrack.max - activeTrack.min)) * graphHeight;
      if (idx === 0) {
        path += `${xCoord} ${yCoord}`;
      } else {
        if (activeTrack.type === 'discrete') {
          const prevX = paddingLeft + (sorted[idx-1].time / timeline.duration) * graphWidth;
          const prevY = paddingTop + (1 - (sorted[idx-1].value - activeTrack.min) / (activeTrack.max - activeTrack.min)) * graphHeight;
          // Step/Discrete draws flat lines, then high jumps
          path += ` L ${xCoord} ${prevY} L ${xCoord} ${yCoord}`;
        } else {
          path += ` L ${xCoord} ${yCoord}`;
        }
      }
    });

    return path;
  }, [activeTrack, timeline.duration]);

  // Loading curated shows / performance presets
  const loadPerformancePreset = async (presetType: 'cyberpunk' | 'ambient' | 'hyperclimax') => {
    // If a track exists in queue, load it into Deck A and load another into Deck B
    let songAName = 'Cyberbeat 1';
    let songBName = 'Techno Drop';
    
    if (queue.length > 0) {
      try {
        const itemA = queue[0];
        engine.deckA.audio.src = URL.createObjectURL(itemA.file);
        engine.deckA.audio.load();
        await engine.deckA.extractPeaks(itemA.file, engine.ctx);
        window.dispatchEvent(new CustomEvent('load-deck-a', { detail: itemA.name }));
        songAName = itemA.name;
        
        if (queue.length > 1) {
          const itemB = queue[1];
          engine.deckB.audio.src = URL.createObjectURL(itemB.file);
          engine.deckB.audio.load();
          await engine.deckB.extractPeaks(itemB.file, engine.ctx);
          window.dispatchEvent(new CustomEvent('load-deck-b', { detail: itemB.name }));
          songBName = itemB.name;
        }
      } catch (e) {
        console.warn("Auto-loading audio tracks skipped:", e);
      }
    }

    if (presetType === 'cyberpunk') {
      const scaleKfs = [
        createKeyframe(0, 1.2),
        createKeyframe(10, 1.8),
        createKeyframe(20, 2.5),
        createKeyframe(25, 4.0), // drop prep
        createKeyframe(27, 0.8), // mini silence
        createKeyframe(28, 4.8), // DROP CLIMAX!
        createKeyframe(40, 2.8),
        createKeyframe(50, 2.0),
        createKeyframe(60, 1.5)
      ];

      const chaosKfs = [
        createKeyframe(0, 30),
        createKeyframe(14, 80),
        createKeyframe(25, 180), // Build-up storm
        createKeyframe(27, 10),  // Dropout drop
        createKeyframe(28, 200), // DROP CLIMAX!
        createKeyframe(45, 120),
        createKeyframe(60, 40)
      ];

      const crossfadeKfs = [
        createKeyframe(0, 0),    // Track A only
        createKeyframe(15, 20),
        createKeyframe(27, 30),
        createKeyframe(28, 100), // Extreme switch on the drop
        createKeyframe(45, 50),  // Center mix
        createKeyframe(60, 100)
      ];

      const rotationSpeedKfs = [
        createKeyframe(0, 0),
        createKeyframe(10, 0.05),
        createKeyframe(20, 0.1),
        createKeyframe(25, 0.2), // rapid spin
        createKeyframe(27, 0),
        createKeyframe(28, 0.15),
        createKeyframe(60, 0.01)
      ];

      const displacementKfs = [
        createKeyframe(0, 0.2),
        createKeyframe(15, 0.8),
        createKeyframe(25, 1.8),
        createKeyframe(27, 0.1),
        createKeyframe(28, 4.5), // massive audio react glitched warp!
        createKeyframe(45, 1.2),
        createKeyframe(60, 0.3)
      ];

      const soundThresholdKfs = [
        createKeyframe(0, 100),
        createKeyframe(28, 40), // Super sensitive to pull triggers on every low bass
        createKeyframe(60, 120)
      ];

      const vizKfs = [
        createKeyframe(0, 0), // Wave at beginning
        createKeyframe(10, 2), // Spiral wave
        createKeyframe(20, 4), // Freq rings
        createKeyframe(27, 6), // Webcam grid
        createKeyframe(28, 5), // Boids drops
        createKeyframe(45, 8), // Shader Bulb
        createKeyframe(60, 0)
      ];

      const moodKfs = [
        createKeyframe(0, 1), // NEON
        createKeyframe(20, 2), // PASTEL
        createKeyframe(28, 3), // MOODY
        createKeyframe(45, 0)  // VIBRANT
      ];

      setTimeline(prev => {
        const updatedTracks = prev.tracks.map(t => {
          if (t.id === 'track-scale') return { ...t, keyframes: scaleKfs };
          if (t.id === 'track-chaos') return { ...t, keyframes: chaosKfs };
          if (t.id === 'track-cross') return { ...t, keyframes: crossfadeKfs };
          if (t.id === 'track-rot') return { ...t, keyframes: rotationSpeedKfs };
          if (t.id === 'track-disp') return { ...t, keyframes: displacementKfs };
          if (t.id === 'track-thresh') return { ...t, keyframes: soundThresholdKfs };
          if (t.id === 'track-viz') return { ...t, keyframes: vizKfs };
          if (t.id === 'track-mood') return { ...t, keyframes: moodKfs };
          return t;
        });
        const next = {
          ...prev,
          duration: 60,
          bpm: 130,
          loop: true,
          tracks: updatedTracks
        };
        timelineRef.current = next;
        return next;
      });

    } else if (presetType === 'ambient') {
      const scaleKfs = [
        createKeyframe(0, 1.5),
        createKeyframe(20, 1.1),
        createKeyframe(45, 2.2),
        createKeyframe(70, 0.8),
        createKeyframe(90, 1.5)
      ];

      const chaosKfs = [
        createKeyframe(0, 20),
        createKeyframe(30, 45),
        createKeyframe(60, 15),
        createKeyframe(90, 25)
      ];

      const crossfadeKfs = [
        createKeyframe(0, 50),
        createKeyframe(45, 45),
        createKeyframe(90, 50)
      ];

      const displacementKfs = [
        createKeyframe(0, 0.1),
        createKeyframe(30, 0.6),
        createKeyframe(60, 0.2),
        createKeyframe(90, 0.1)
      ];

      const vizKfs = [
        createKeyframe(0, 2), // Spiral
        createKeyframe(30, 1), // Circular
        createKeyframe(60, 8), // Shader Bulb
        createKeyframe(90, 2)
      ];

      const moodKfs = [
         createKeyframe(0, 2), // PASTEL
         createKeyframe(45, 3), // MOODY
         createKeyframe(90, 2)
      ];

      setTimeline(prev => {
        const updatedTracks = prev.tracks.map(t => {
          if (t.id === 'track-scale') return { ...t, keyframes: scaleKfs };
          if (t.id === 'track-chaos') return { ...t, keyframes: chaosKfs };
          if (t.id === 'track-cross') return { ...t, keyframes: crossfadeKfs };
          if (t.id === 'track-disp') return { ...t, keyframes: displacementKfs };
          if (t.id === 'track-viz') return { ...t, keyframes: vizKfs };
          if (t.id === 'track-mood') return { ...t, keyframes: moodKfs };
          return t;
        });
        const next = {
          ...prev,
          duration: 90,
          bpm: 90,
          loop: true,
          tracks: updatedTracks
        };
        timelineRef.current = next;
        return next;
      });

    } else if (presetType === 'hyperclimax') {
       // Intense 30s visual build
       const scaleKfs = [
         createKeyframe(0, 1.0),
         createKeyframe(10, 2.5),
         createKeyframe(20, 3.8),
         createKeyframe(24, 5.0),
         createKeyframe(25, 1.2),
         createKeyframe(30, 4.0)
       ];

       const chaosKfs = [
         createKeyframe(0, 60),
         createKeyframe(10, 100),
         createKeyframe(20, 160),
         createKeyframe(24, 200),
         createKeyframe(25, 20),
         createKeyframe(30, 180)
       ];

       const rotationKfs = [
         createKeyframe(0, 0.02),
         createKeyframe(15, 0.12),
         createKeyframe(24, 0.25),
         createKeyframe(25, 0.05),
         createKeyframe(30, 0.2)
       ];

       const crossfadeKfs = [
         createKeyframe(0, 10),
         createKeyframe(15, 60),
         createKeyframe(30, 90)
       ];

       setTimeline(prev => {
         const updatedTracks = prev.tracks.map(t => {
           if (t.id === 'track-scale') return { ...t, keyframes: scaleKfs };
           if (t.id === 'track-chaos') return { ...t, keyframes: chaosKfs };
           if (t.id === 'track-rot') return { ...t, keyframes: rotationKfs };
           if (t.id === 'track-cross') return { ...t, keyframes: crossfadeKfs };
           return t;
         });
         const next = {
           ...prev,
           duration: 30,
           bpm: 145,
           loop: true,
           tracks: updatedTracks
         };
         timelineRef.current = next;
         return next;
       });
    }

    // Alert system
    updateVjSetting('paletteMood', presetType === 'ambient' ? 'PASTEL' : 'NEON');
  };

  // Quick helper to wipe track nodes
  const clearTrack = () => {
    if (!activeTrack) return;
    updateTrackKeyframes(activeTrack.id, []);
    setSelectedKeyframeId(null);
  };

  const handlePlayToggle = () => {
    const isPlayingNext = !timeline.isPlaying;
    updateTimelineConfig({ isPlaying: isPlayingNext });
    if (isPlayingNext) {
      // Resume audio contexts if paused
      if (engine && engine.ctx && engine.ctx.state === 'suspended') {
        engine.ctx.resume();
      }
      // If we have music, sync it!
      if (timeline.audioSync) {
        if (engine && engine.deckA && engine.deckA.audio.paused) {
          engine.deckA.audio.play().catch((e: any) => console.log("Audio play skip:", e));
        }
      }
    } else {
      if (engine && engine.deckA && !engine.deckA.audio.paused) {
        engine.deckA.audio.pause();
      }
    }
  };

  const handleStop = () => {
    updateTimelineConfig({ isPlaying: false, time: 0 });
    if (engine && engine.deckA) {
      engine.deckA.audio.pause();
      engine.deckA.audio.currentTime = 0;
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#111114] border-t-2 border-[#1e1e24] shadow-[0_-12px_30px_rgba(0,0,0,0.6)] font-mono text-zinc-300">
      
      {/* Timeline Controls Header */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 border-b border-[#202029] bg-[#121217] gap-3 shrink-0">
        
        <div className="flex items-center gap-2">
          <Disc size={18} className={`text-orange-500 ${timeline.isPlaying ? 'animate-spin-slow' : ''}`} />
          <span className="orbitron font-extrabold text-fluid-sm tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-amber-400">
            AUDIO-VISUAL PROGRAM TIMELINE
          </span>
          <div className="h-5 w-px bg-zinc-800"></div>
          <span className="text-[10px] text-zinc-500 tracking-widest uppercase">PRO MULTI-LANE SEQUENCER</span>
        </div>

        {/* Master Clock & Sliders */}
        <div className="flex items-center gap-4 text-fluid-xs">
          
          <div className="flex items-center gap-2 bg-zinc-950/85 px-3 py-1 border border-zinc-900 rounded-[2px]">
            <Clock size={12} className="text-orange-500" />
            <span className="text-zinc-600">TIME:</span>
            <span className="text-orange-500 font-bold min-w-[3.5rem] text-right">
              {currentTimeLocal.toFixed(2)}s
            </span>
            <span className="text-zinc-700">/</span>
            <span className="text-zinc-400">{timeline.duration}s</span>
          </div>

          <div className="flex items-center gap-2 bg-zinc-950/85 px-3 py-1 border border-zinc-900 rounded-[2px]">
            <span className="text-zinc-600">BPM:</span>
            <input 
              type="number" 
              min="50" 
              max="240" 
              value={timeline.bpm}
              onChange={e => updateTimelineConfig({ bpm: parseInt(e.target.value) || 120 })}
              className="w-10 bg-transparent text-amber-500 font-bold focus:outline-none border-b border-zinc-800 text-center"
            />
          </div>

          <button
            onClick={() => updateTimelineConfig({ audioSync: !timeline.audioSync })}
            className={`px-3 py-1 text-[11px] font-bold border rounded-[2px] transition-all tracking-wider flex items-center gap-1.5 ${
              timeline.audioSync 
                ? 'border-[#22c55e]/50 bg-[#22c55e]/10 text-green-400 shadow-[0_0_8px_rgba(34,197,94,0.15)]' 
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
            }`}
            title="Lock Playhead To Master Deck Audio Timing"
          >
            <Disc size={11} className={timeline.audioSync ? 'animate-spin' : ''} />
            AUDIO TIMING SYNC
          </button>

          <button
            onClick={() => updateTimelineConfig({ loop: !timeline.loop })}
            className={`px-3 py-1 text-[11px] font-bold border rounded-[2px] transition-all tracking-wider ${
              timeline.loop 
                ? 'border-orange-500/50 bg-orange-500/10 text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.15)]' 
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
            }`}
          >
            LOOP: {timeline.loop ? 'ON' : 'OFF'}
          </button>

        </div>

        {/* Master Transport */}
        <div className="flex items-center gap-2">
          <button 
            onClick={handlePlayToggle}
            className={`w-10 h-8 font-bold border transition-all flex items-center justify-center rounded-[2px] ${
              timeline.isPlaying 
                ? 'bg-green-600 text-black border-green-500 hover:bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.4)]'
                : 'bg-orange-500 text-black border-orange-400 hover:bg-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.3)]'
            }`}
            title={timeline.isPlaying ? "Pause Timeline Sequence" : "Start Timeline Automation"}
          >
            {timeline.isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          
          <button 
            onClick={handleStop}
            className="w-10 h-8 font-bold bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-red-500 hover:text-red-500 transition-all flex items-center justify-center rounded-[2px]"
            title="Reset to Start"
          >
            <div className="w-3 h-3 bg-current"></div>
          </button>
        </div>

      </div>

      {/* Main Timeline Workspace (Tracks sidebar + Graph canvas editor) */}
      <div className="flex-1 flex overflow-hidden min-h-0 bg-[#0c0c0e]">
        
        {/* Track Selection Sidebar */}
        <div className="w-[180px] border-r border-[#1e1e24] flex flex-col overflow-y-auto bg-[#0d0d10] shrink-0 custom-scrollbar divide-y divide-[#16161b]">
          <div className="p-2 text-[10px] text-zinc-600 uppercase tracking-widest bg-zinc-950/40">
            Control Lanes
          </div>
          {timeline.tracks.map(track => {
            const activeVal = getInterpolatedValueAtTime(track, currentTimeLocal);
            const isSelected = track.id === activeTrackId;
            return (
              <button
                key={track.id}
                onClick={() => {
                  setActiveTrackId(track.id);
                  setSelectedKeyframeId(null);
                }}
                className={`w-full p-2.5 text-left transition-all relative flex flex-col gap-1 ${
                  isSelected 
                    ? 'bg-zinc-900/60 border-l-4 border-orange-500 text-white font-bold' 
                    : 'text-zinc-400 hover:bg-zinc-900/20 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between text-fluid-xs">
                  <span className="truncate pr-1 uppercase tracking-wide">{track.name}</span>
                  <Sliders size={10} className={isSelected ? 'text-orange-500' : 'text-zinc-700'} />
                </div>
                
                {/* Live parameter overlay dynamic value */}
                <div className="flex justify-between items-center text-[10px] font-mono select-none">
                  <span className="text-zinc-600 text-[9px] font-normal leading-none bg-zinc-950/60 px-1 rounded">
                    {track.keyframes.length} PTS
                  </span>
                  <span className={`font-bold tabular-nums ${isSelected ? 'text-amber-500' : 'text-zinc-500'}`}>
                    {track.type === 'discrete' 
                      ? getDiscreteLabel(track.id, activeVal) 
                      : activeVal.toFixed(2)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Graphics Edit Canvas Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          
          {/* Active node actions / Help bar */}
          <div className="h-9 px-4 border-b border-[#18181d] bg-[#0d0d10]/95 flex items-center justify-between text-fluid-xs text-zinc-400 tracking-wider shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-zinc-600 uppercase text-[9px]">Editing Track:</span>
              <span className="text-orange-400 font-bold uppercase">{activeTrack?.name}</span>
              <span className="text-zinc-700">|</span>
              <span className="text-zinc-500 text-[10px] italic">
                Click in grid to place new nodes. Drag nodes to reshape automation vector.
              </span>
            </div>

            <div className="flex items-center gap-2">
              {selectedKeyframeId ? (
                <>
                  <span className="text-zinc-500 leading-none">NODE ACTIVE:</span>
                  <button 
                    onClick={deleteSelectedKeyframe}
                    className="flex items-center gap-1 bg-red-950/80 border border-red-900/50 hover:bg-red-800 hover:border-red-500 text-red-400 px-2.0 py-0.5 rounded-[2px] transition-colors leading-tight font-bold text-[10px]"
                  >
                    <Trash size={10} /> DELETE PT
                  </button>
                </>
              ) : null}
              <button 
                onClick={clearTrack} 
                className="bg-zinc-900 hover:bg-zinc-800 hover:text-white border border-zinc-800 px-2 py-0.5 rounded-[2px] transition-colors text-zinc-500 font-bold text-[10px]"
                title="Wipe keyframe nodes for active parameter"
              >
                RESET CAROUSEL
              </button>
            </div>
          </div>

          {/* SVG Graph Layout */}
          <div className="flex-1 relative overflow-hidden bg-black select-none p-2">
            
            {activeTrack && (
              <svg
                ref={svgRef}
                className="w-full h-full bg-[#07070a]/80"
                onClick={handleSvgClick}
                onMouseMove={(e) => {
                  if (!svgRef.current) return;
                  const rect = svgRef.current.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  const paddingLeft = 40;
                  const paddingRight = 20;
                  const graphWidth = rect.width - paddingLeft - paddingRight;
                  if (x >= paddingLeft && x <= rect.width - paddingRight) {
                    const norm = (x - paddingLeft) / graphWidth;
                    setHoveredPoint({ x: norm * timeline.duration, y });
                  } else {
                    setHoveredPoint(null);
                  }
                }}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                {/* Horizontal Coordinate Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((p, idx) => (
                  <g key={`grid-y-${idx}`}>
                    <line 
                      x1="40" 
                      y1={`${20 + p * 160}`} 
                      x2="calc(100% - 20px)" 
                      y2={`${20 + p * 160}`} 
                      stroke="#14141a" 
                      strokeWidth={1} 
                    />
                    <text 
                      x="32" 
                      y={`${20 + p * 160 + 4}`} 
                      fill="#4b5563" 
                      fontSize="9" 
                      textAnchor="end"
                      fontFamily="monospace"
                    >
                      {activeTrack.type === 'discrete'
                        ? getDiscreteLabel(activeTrack.id, activeTrack.max - p * (activeTrack.max - activeTrack.min))
                        : (activeTrack.max - p * (activeTrack.max - activeTrack.min)).toFixed(1)}
                    </text>
                  </g>
                ))}

                {/* Vertical Beat/Timing Bar Guides */}
                {Array.from({ length: Math.ceil(timeline.duration / 5) + 1 }).map((_, idx) => {
                  const s = idx * 5;
                  if (s > timeline.duration) return null;
                  return (
                    <g key={`grid-x-${idx}`}>
                      <line 
                        x1={`calc(40px + ${s / timeline.duration} * (100% - 60px))`}
                        y1="20" 
                        x2={`calc(40px + ${s / timeline.duration} * (100% - 60px))`}
                        y2="180" 
                        stroke="#14141a" 
                        strokeWidth={1} 
                      />
                      <text 
                        x={`calc(40px + ${s / timeline.duration} * (100% - 60px))`}
                        y="192" 
                        fill="#4b5563" 
                        fontSize="9" 
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {s}s
                      </text>
                    </g>
                  );
                })}

                {/* Draw Automation Spline Line Path */}
                {linePathMarkup && (
                  <path
                    d={linePathMarkup}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth={2}
                    className="drop-shadow-[0_0_10px_rgba(249,115,22,0.4)] pointer-events-none"
                  />
                )}

                {/* Draw Keyframe Anchor Nodes */}
                {activeTrack.keyframes.map(kf => {
                  const sorted = [...activeTrack.keyframes].sort((a,b) => a.time - b.time);
                  const isSelected = kf.id === selectedKeyframeId;
                  const isFirstOrLast = sorted[0]?.id === kf.id || sorted[sorted.length - 1]?.id === kf.id;
                  
                  return (
                    <circle
                      key={kf.id}
                      cx={`calc(40px + ${kf.time / timeline.duration} * (100% - 60px))`}
                      cy={`calc(20px + ${1 - (kf.value - activeTrack.min) / (activeTrack.max - activeTrack.min)} * 160px)`}
                      r={isSelected ? 6 : 4}
                      fill={isSelected ? '#f97316' : '#a1a1aa'}
                      stroke={isSelected ? '#ffffff' : '#18181b'}
                      strokeWidth={1.5}
                      className="cursor-pointer hover:scale-125 transition-transform"
                      onMouseDown={(e) => handleKeyframeMouseDown(e, kf)}
                    />
                  );
                })}

                {/* Moving Playhead Scrubber Axis Line */}
                <line 
                  x1={`calc(40px + ${currentTimeLocal / timeline.duration} * (100% - 60px))`}
                  y1="10" 
                  x2={`calc(40px + ${currentTimeLocal / timeline.duration} * (100% - 60px))`}
                  y2="182" 
                  stroke="#ef4444" 
                  strokeWidth={1.8} 
                  className="drop-shadow-[0_0_5px_rgba(239,68,68,0.7)] pointer-events-none"
                />
                
                <polygon 
                  points={`
                    calc(40px + ${currentTimeLocal / timeline.duration} * (100% - 60px) - 5px), 10
                    calc(40px + ${currentTimeLocal / timeline.duration} * (100% - 60px) + 5px), 10
                    calc(40px + ${currentTimeLocal / timeline.duration} * (100% - 60px)), 16
                  `} 
                  fill="#ef4444"
                />

                {/* Hover Coordinates tooltip */}
                {hoveredPoint && (
                  <text 
                    x="50" 
                    y="15" 
                    fill="#a1a1aa" 
                    fontSize="9" 
                    fontFamily="monospace"
                  >
                    CURSOR: {hoveredPoint.x.toFixed(2)}s
                  </text>
                )}
              </svg>
            )}

            {/* Quick Presets Side panel */}
            <div className="absolute right-3 bottom-10 top-3 w-[150px] flex flex-col gap-2 p-2 bg-[#0d0d10]/95 border border-[#1e1e24] rounded-[3px] shadow-2xl overflow-y-auto">
              <div className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase mb-1 flex items-center gap-1 border-b border-zinc-800 pb-1">
                <Sparkles size={10} className="text-amber-500" /> SHOW SHOWS
              </div>
              <button 
                onClick={() => loadPerformancePreset('cyberpunk')}
                className="w-full text-[9px] font-bold text-left px-2 py-1.5 bg-orange-600 text-black font-mono border border-orange-500 hover:bg-orange-500 transition-colors tracking-tighter uppercase leading-tight"
              >
                1. CYBERPUNK RAVE LOOP
              </button>
              <button 
                onClick={() => loadPerformancePreset('ambient')}
                className="w-full text-[9px] font-bold text-left px-2 py-1.5 bg-teal-900 border border-teal-800 hover:border-teal-500 text-teal-400 font-mono transition-colors tracking-tighter uppercase leading-tight"
              >
                2. AMBIENT DRIFT COIL
              </button>
              <button 
                onClick={() => loadPerformancePreset('hyperclimax')}
                className="w-full text-[9px] font-bold text-left px-2 py-1.5 bg-purple-950 border border-purple-900 hover:border-purple-500 text-purple-400 font-mono transition-colors tracking-tighter uppercase leading-tight"
              >
                3. NEON HYPER CLIMAX
              </button>

              <div className="mt-auto border-t border-zinc-900 pt-2 text-[9px] text-zinc-600 text-center leading-normal">
                Select a preset to load automated sound/visual show instantly!
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
