import { FilesetResolver, FaceLandmarker, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, FastForward, Settings, Camera, Maximize, Sliders, Music, X, ArrowUp, ArrowDown, Mic, Monitor, PenTool, Circle, MonitorPlay, Cpu, Disc } from 'lucide-react';
import PerspT from './perspective-transform'; // Use local fixed version instead of 'perspective-transform'
import MasterTimeline, { ActiveTimeline, TimelineTrack, Keyframe } from './components/MasterTimeline';

function CameraUIPreview({ cameraVideoRef }: any) {
  const uiPreviewRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (uiPreviewRef.current && cameraVideoRef.current?.srcObject) {
       uiPreviewRef.current.srcObject = cameraVideoRef.current.srcObject;
    }
  }, [cameraVideoRef, cameraVideoRef.current?.srcObject]);
  return (
    <div className="w-full aspect-video bg-black border border-zinc-800 rounded overflow-hidden mt-3 relative">
       <div className="absolute top-2 right-2 text-fluid-xs font-bold tracking-widest uppercase bg-orange-600 px-2 py-0.5 rounded text-black z-10">AI TRACKING LIVE</div>
       <video ref={uiPreviewRef} autoPlay playsInline muted className="w-full h-full object-cover origin-center scale-x-[-1]" />
    </div>
  );
}

interface VJLayer {
  id: string;
  name: string;
  type: 'visualizer' | 'video' | 'camera';
  active: boolean;
  opacity: number;
  scale: number;
  rotation: number;
  perspective: number;
  skewX: number;
  skewY: number;
  offsetX: number;
  offsetY: number;
  blendMode: GlobalCompositeOperation;
  visualizerMode: number;
  prevVisualizerMode?: number;
  transitionFactor: number;
  videoSrc: string;
  points: { x: number; y: number }[];
  mapping: {
    scale: 'none' | 'bass' | 'mid' | 'high';
    rotation: 'none' | 'bass' | 'mid' | 'high';
    opacity: 'none' | 'bass' | 'mid' | 'high';
    displacement: 'none' | 'bass' | 'mid' | 'high';
  };
}

interface MapSurface {
  id: string;
  name: string;
  points: {x: number, y: number}[];
}

interface VJSettings {
  autoHue: boolean;
  color: string;
  scale: number;
  rotationSpeed: number;
  ringSpeed: number;
  ringDensity: number;
  threshold: number;
  displacement: number;
  maskThresholdColor: string;
  maskSensitivity: number;
  maskAudioGlitch: number;
  camDensity: number;
  activeVisualizer: number;
  isVideoActive: boolean;
  isVideoPlaying: boolean;
  videoOpacity: number;
  videoSrc: string;
  isMappingActive: boolean;
  isMaskingActive: boolean;
  videoReverseLoop?: boolean;
  videoDirection?: 'forward' | 'backward';
  customMask: {
    active: boolean;
    points: {x: number, y: number}[];
    invert: boolean;
    type?: 'polygon' | 'circle';
    circleX?: number;
    circleY?: number;
    circleRadius?: number;
  };
  isCameraActive: boolean;
  layers: VJLayer[];
  chaosDensity: number;
  chaosLevel: number;
  splatFrequency: number;
  paletteMood: 'VIBRANT' | 'NEON' | 'PASTEL' | 'MOODY';
  mapSurfaces: MapSurface[];
  activeMapSurfaceId: string | null;
}

class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  analyser: AnalyserNode;
  deckA: Deck;
  deckB: Deck;
  
  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    
    this.deckA = new Deck(this.ctx, this.masterGain);
    this.deckB = new Deck(this.ctx, this.masterGain);
  }

  updateMixer(crossfader: number, masterVol: number) {
    const x = crossfader / 100;
    const m = masterVol / 100;

    const gainA = Math.cos(x * 0.5 * Math.PI) * (this.deckA.vol / 100);
    const gainB = Math.sin(x * 0.5 * Math.PI) * (this.deckB.vol / 100);

    this.deckA.gainNode.gain.setTargetAtTime(gainA, this.ctx.currentTime, 0.01);
    this.deckB.gainNode.gain.setTargetAtTime(gainB, this.ctx.currentTime, 0.01);
    this.masterGain.gain.setTargetAtTime(m, this.ctx.currentTime, 0.01);
  }
}

class Deck {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gainNode: GainNode;
  highNode: BiquadFilterNode;
  lowNode: BiquadFilterNode;
  sweepNode: BiquadFilterNode;
  
  vol: number = 100;
  peaks: number[] = [];
  
  constructor(ctx: AudioContext, masterBus: GainNode) {
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.source = ctx.createMediaElementSource(this.audio);
    
    this.highNode = ctx.createBiquadFilter();
    this.highNode.type = "highshelf";
    this.highNode.frequency.value = 3200;

    this.lowNode = ctx.createBiquadFilter();
    this.lowNode.type = "lowshelf";
    this.lowNode.frequency.value = 320;

    this.sweepNode = ctx.createBiquadFilter();
    this.sweepNode.type = "allpass";

    this.gainNode = ctx.createGain();

    this.source.connect(this.highNode);
    this.highNode.connect(this.lowNode);
    this.lowNode.connect(this.sweepNode);
    this.sweepNode.connect(this.gainNode);

    this.gainNode.connect(masterBus);
  }

  setFilter(val: number) {
    if (val < 48) {
      this.sweepNode.type = "lowpass";
      this.sweepNode.frequency.value = Math.pow(10, (val / 48) * 4.3);
    } else if (val > 52) {
      this.sweepNode.type = "highpass";
      this.sweepNode.frequency.value = Math.pow(10, ((val - 52) / 48) * 4.3);
    } else {
      this.sweepNode.type = "allpass";
    }
  }

  async extractPeaks(file: File, ctx: AudioContext) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);

      const numPeaks = 200;
      const step = Math.ceil(channelData.length / numPeaks);
      this.peaks = [];

      for (let i = 0; i < numPeaks; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) {
          const val = Math.abs(channelData[i * step + j] || 0);
          if (val > max) max = val;
        }
        this.peaks.push(max);
      }
    } catch (e) {
      console.error("Error decoding audio for waveform", e);
    }
  }
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const engineRef = useRef<AudioEngine | null>(null);

  if (!booted) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center font-mono">
        <div className="mb-4 text-fluid-sm text-orange-800 w-64">
          {'>'} INITIALIZING AUDIO_ENGINE...<br />
          {'>'} LOADING AUTOMIX_MODULE...<br />
          {'>'} SYSTEM READY.
        </div>
        <h1 className="text-7xl font-bold text-orange-500 mb-8 tracking-tighter orbitron" style={{ textShadow: '0 0 10px rgba(255,94,0,0.5)' }}>
          RUSH XR
        </h1>
        <button
          onClick={() => {
            engineRef.current = new AudioEngine();
            setBooted(true);
          }}
          className="px-12 py-4 border-2 border-orange-600 text-orange-500 hover:bg-orange-600 hover:text-white transition-all duration-300 rounded font-bold tracking-widest orbitron"
        >
          START STUDIO
        </button>
      </div>
    );
  }

  return <Studio engine={engineRef.current!} />;
}

function Studio({ engine }: { engine: AudioEngine }) {
  const [crossfader, setCrossfader] = useState(50);
  const [masterVol, setMasterVol] = useState(80);
  const [queue, setQueue] = useState<{id: string, file: File, name: string}[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [workspaceZoom, setWorkspaceZoom] = useState(1);
  const [workspacePan, setWorkspacePan] = useState({ x: 0, y: 0 });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  isRecordingRef.current = isRecording;
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const defaultTimeline: ActiveTimeline = {
    isPlaying: false,
    time: 0,
    duration: 60,
    bpm: 120,
    loop: true,
    audioSync: false,
    tracks: [
      { id: 'track-scale', name: 'Scale', min: 0.5, max: 5.0, defaultValue: 1.8, type: 'analog', keyframes: [] },
      { id: 'track-chaos', name: 'Chaos Density', min: 10, max: 200, defaultValue: 60, type: 'analog', keyframes: [] },
      { id: 'track-rot', name: 'Rotation Speed', min: 0.0, max: 0.2, defaultValue: 0.0, type: 'analog', keyframes: [] },
      { id: 'track-disp', name: 'Displacement', min: 0.0, max: 10.0, defaultValue: 0.0, type: 'analog', keyframes: [] },
      { id: 'track-cross', name: 'Crossfader', min: 0, max: 100, defaultValue: 50, type: 'analog', keyframes: [] },
      { id: 'track-thresh', name: 'Sound Threshold', min: 10, max: 200, defaultValue: 100, type: 'analog', keyframes: [] },
      { id: 'track-viz', name: 'Visualizer mode', min: 0, max: 8, defaultValue: 0, type: 'discrete', keyframes: [] },
      { id: 'track-mood', name: 'Palette Mood', min: 0, max: 3, defaultValue: 0, type: 'discrete', keyframes: [] }
    ]
  };

  const [bottomPanelTab, setBottomPanelTab] = useState<'djmix' | 'timeline'>('timeline');
  const [timeline, setTimeline] = useState<ActiveTimeline>(defaultTimeline);
  const timelineRef = useRef<ActiveTimeline>(defaultTimeline);

  const vjSettings = useRef<VJSettings>({
    autoHue: false,
    color: '#ff5e00',
    scale: 1.8,
    rotationSpeed: 0.0,
    ringSpeed: 0.0,
    ringDensity: 0,
    threshold: 100,
    displacement: 0.0,
    maskThresholdColor: '#121212',
    maskSensitivity: 0.7,
    maskAudioGlitch: 0.5,
    camDensity: 16,
    activeVisualizer: 0,
    isVideoActive: false,
    isVideoPlaying: false,
    videoOpacity: 0.5,
    videoSrc: '',
    isMappingActive: false,
    isMaskingActive: false,
    videoReverseLoop: false,
    videoDirection: 'forward',
    customMask: {
      active: true,
      points: [],
      invert: false,
      type: 'polygon',
      circleX: 0.5,
      circleY: 0.5,
      circleRadius: 0.25,
    },
    isCameraActive: false,
    chaosDensity: 60,
    chaosLevel: 0.8,
    splatFrequency: 0.4,
    paletteMood: 'VIBRANT',
    layers: [
      {
        id: 'layer-1',
        name: 'Background',
        type: 'visualizer',
        active: true,
        opacity: 1,
        rotation: 0,
        perspective: 400,
        skewX: 0,
        skewY: 0,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        blendMode: 'source-over' as GlobalCompositeOperation,
        visualizerMode: 0,
        transitionFactor: 1,
        videoSrc: '',
        points: [
          {x: 0, y: 0},
          {x: 1, y: 0},
          {x: 1, y: 1},
          {x: 0, y: 1}
        ],
        mapping: {
          scale: 'none',
          rotation: 'none',
          opacity: 'none',
          displacement: 'none'
        }
      }
    ],
    mapSurfaces: (() => {
       try {
           const saved = localStorage.getItem('rush_xr_surfaces');
           if (saved) {
               const parsed = JSON.parse(saved);
               if (parsed.length > 0 && parsed[0].points[1].x > 2) {
                   // Invalidate old absolute pixel coordinates
                   localStorage.removeItem('rush_xr_surfaces');
               } else {
                   return parsed;
               }
           }
       } catch(e) {}
       return [
         {
           id: 'surf-1',
           name: 'Main Display',
           points: [
             {x: 0.1, y: 0.1},
             {x: 0.9, y: 0.1},
             {x: 0.9, y: 0.9},
             {x: 0.1, y: 0.9}
           ]
         }
       ];
    })(),
    activeMapSurfaceId: 'surf-1'
  });

  const [vjState, setVjState] = useState<VJSettings>({...vjSettings.current});
  const videoCache = useRef<Map<string, HTMLVideoElement>>(new Map());

  const updateVjSetting = useCallback((key: string, value: any) => {
    if (vjSettings.current[key as keyof VJSettings] === value) return;
    vjSettings.current = { ...vjSettings.current, [key]: value };
    setVjState({...vjSettings.current});
  }, []);

  const updateLayer = useCallback((id: string, updates: any) => {
    const newLayers = vjSettings.current.layers.map(l => {
      if (l.id === id) {
        const updated = { ...l, ...updates };
        
        // Handle Visualizer Transition
        if (updates.visualizerMode !== undefined && updates.visualizerMode !== l.visualizerMode) {
          updated.prevVisualizerMode = l.visualizerMode;
          updated.transitionFactor = 0;
        }

        // Handle Video Source
        if (updates.videoSrc && updated.type === 'video') {
          let video = videoCache.current.get(id);
          if (!video) {
            video = document.createElement('video');
            video.loop = true;
            video.muted = true;
            video.crossOrigin = "anonymous";
            videoCache.current.set(id, video);
          }
          video.src = updates.videoSrc;
          video.play().catch(e => console.error("Video play error:", e));
        }
        return updated;
      }
      return l;
    });
    updateVjSetting('layers', newLayers);
  }, [updateVjSetting]);

  const addLayer = useCallback((type: 'visualizer' | 'video' | 'camera') => {
    const id = `layer-${Date.now()}`;
    const newLayer: VJLayer = {
      id,
      name: `Layer ${vjSettings.current.layers.length + 1}`,
      type,
      active: true,
      opacity: 0.8,
      rotation: 0,
      perspective: 400,
      skewX: 0,
      skewY: 0,
      offsetX: 0,
      offsetY: 0,
      scale: 0.8,
      blendMode: 'screen' as GlobalCompositeOperation,
      visualizerMode: vjSettings.current.activeVisualizer,
      transitionFactor: 1,
      videoSrc: vjSettings.current.videoSrc,
      points: [
        {x: 0.1, y: 0.1},
        {x: 0.9, y: 0.1},
        {x: 0.9, y: 0.9},
        {x: 0.1, y: 0.9}
      ],
      mapping: {
        scale: 'none',
        rotation: 'none',
        opacity: 'none',
        displacement: 'none'
      }
    };

    if (type === 'video' && vjSettings.current.videoSrc) {
      const video = document.createElement('video');
      video.loop = true;
      video.muted = true;
      video.crossOrigin = "anonymous";
      video.src = vjSettings.current.videoSrc;
      videoCache.current.set(id, video);
      video.play().catch(e => console.error("Video play error:", e));
    }

    updateVjSetting('layers', [...vjSettings.current.layers, newLayer]);
  }, [updateVjSetting]);

  const removeLayer = useCallback((id: string) => {
    const newLayers = vjSettings.current.layers.filter(l => l.id !== id);
    const video = videoCache.current.get(id);
    if (video) {
      video.pause();
      video.src = "";
      videoCache.current.delete(id);
    }
    updateVjSetting('layers', newLayers);
  }, [updateVjSetting]);

  const mixCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const mediaVideoRef = useRef<HTMLVideoElement>(null);
  const segmentationCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const queuePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const mappingRawPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const surfaceCanvasesRef = useRef<{[id: string]: HTMLCanvasElement}>({});
  const projSurfaceCanvasesRef = useRef<{[id: string]: HTMLCanvasElement}>({});

  const [projectorWindow, setProjectorWindow] = useState<Window | null>(null);

  const addMapSurface = useCallback(() => {
    const id = `surf-${Date.now()}`;
    const newSurface: MapSurface = {
      id,
      name: `Display ${vjSettings.current.mapSurfaces.length + 1}`,
      points: [
        {x: 0.1, y: 0.1},
        {x: 0.9, y: 0.1},
        {x: 0.9, y: 0.9},
        {x: 0.1, y: 0.9}
      ]
    };
    updateVjSetting('mapSurfaces', [...vjSettings.current.mapSurfaces, newSurface]);
    updateVjSetting('activeMapSurfaceId', id);
  }, [updateVjSetting]);

  const removeMapSurface = useCallback((id: string) => {
    const newSurfaces = vjSettings.current.mapSurfaces.filter(s => s.id !== id);
    if (newSurfaces.length === 0) return; // Prevent deleting all surfaces
    updateVjSetting('mapSurfaces', newSurfaces);
    if (vjSettings.current.activeMapSurfaceId === id) {
       updateVjSetting('activeMapSurfaceId', newSurfaces[0].id);
    }
  }, [updateVjSetting]);

  useEffect(() => {
    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case '?':
        case 'h':
          setShowLegend(prev => !prev);
          break;
        case 'm':
          updateVjSetting('isMappingActive', !vjSettings.current.isMappingActive);
          break;
        case 'p':
          updateVjSetting('isMaskingActive', !vjSettings.current.isMaskingActive);
          break;
        case 'enter':
          if (vjSettings.current.isMaskingActive) {
             updateVjSetting('isMaskingActive', false);
          }
          break;
        case 'backspace':
          if (vjSettings.current.isMaskingActive) {
             const currentPoints = vjSettings.current.customMask.points;
             if (currentPoints.length > 0) {
               updateVjSetting('customMask', { 
                 ...vjSettings.current.customMask, 
                 points: currentPoints.slice(0, -1) 
               });
             }
          }
          break;
        case 'v':
          updateVjSetting('isVideoActive', !vjSettings.current.isVideoActive);
          break;
        case 'c':
          window.dispatchEvent(new CustomEvent('regenerate-chaos'));
          break;
        case 'Escape':
        case 'escape':
          setShowLegend(false);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [updateVjSetting]);

  useEffect(() => {
    if (!vjState.isMappingActive) return;
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [vjState.isMappingActive]);

  useEffect(() => {
    const handleAdd = () => addMapSurface();
    const handleRemove = (e: any) => removeMapSurface(e.detail);
    window.addEventListener('add-map-surface', handleAdd);
    window.addEventListener('remove-map-surface', handleRemove);
    return () => {
      window.removeEventListener('add-map-surface', handleAdd);
      window.removeEventListener('remove-map-surface', handleRemove);
    };
  }, [addMapSurface, removeMapSurface]);

  const triggerMapTransformUpdate = useCallback(() => {
    // Save surfaces to localStorage whenever they change during mapping
    try {
       localStorage.setItem('rush_xr_surfaces', JSON.stringify(vjSettings.current.mapSurfaces));
    } catch(e) {}

    vjSettings.current.mapSurfaces.forEach(surf => {
        const pts = surf.points;
        const mainCanvas = surfaceCanvasesRef.current[surf.id];
        if (mainCanvas && mixCanvasRef.current) {
            const w = mixCanvasRef.current.width || window.innerWidth;
            const h = mixCanvasRef.current.height || window.innerHeight;
            
            let workW = w;
            let workH = h;
            if (workspaceRef.current) {
                workW = workspaceRef.current.offsetWidth || w;
                workH = workspaceRef.current.offsetHeight || h;
            }
            
            const srcCorners = [0, 0, w, 0, w, h, 0, h];
            const dstCorners = [
                pts[0].x * workW, pts[0].y * workH, 
                pts[1].x * workW, pts[1].y * workH, 
                pts[2].x * workW, pts[2].y * workH, 
                pts[3].x * workW, pts[3].y * workH
            ];
            try {
                const t = PerspT(srcCorners, dstCorners).coeffs;
                if (!t || t.some((v: any) => isNaN(v))) throw new Error('Invalid transform matrix');
                mainCanvas.style.width = `${w}px`;
                mainCanvas.style.height = `${h}px`;
                mainCanvas.style.transformOrigin = '0 0';
                mainCanvas.style.transform = `matrix3d(${t[0]}, ${t[3]}, 0, ${t[6]}, ${t[1]}, ${t[4]}, 0, ${t[7]}, 0, 0, 1, 0, ${t[2]}, ${t[5]}, 0, ${t[8]})`;
            } catch (e) {
                console.error("Transform error:", e);
            }
        }

        const projCanvas = projSurfaceCanvasesRef.current[surf.id];
        if (projCanvas && projectorWindow && mixCanvasRef.current) {
            const w = mixCanvasRef.current.width || window.innerWidth;
            const h = mixCanvasRef.current.height || window.innerHeight;
            const projW = projectorWindow.innerWidth;
            const projH = projectorWindow.innerHeight;
            
            const srcCorners = [0, 0, w, 0, w, h, 0, h];
            const pDstCorners = [
               pts[0].x * projW, pts[0].y * projH,
               pts[1].x * projW, pts[1].y * projH,
               pts[2].x * projW, pts[2].y * projH,
               pts[3].x * projW, pts[3].y * projH
            ];
            try {
               const pt = PerspT(srcCorners, pDstCorners).coeffs;
               if (!pt || pt.some((v: any) => isNaN(v))) throw new Error('Invalid transform matrix');
               projCanvas.style.width = `${w}px`;
               projCanvas.style.height = `${h}px`;
               projCanvas.style.transformOrigin = '0 0';
               projCanvas.style.transform = `matrix3d(${pt[0]}, ${pt[3]}, 0, ${pt[6]}, ${pt[1]}, ${pt[4]}, 0, ${pt[7]}, 0, 0, 1, 0, ${pt[2]}, ${pt[5]}, 0, ${pt[8]})`;
            } catch (e) {}
        }
    });
  }, [projectorWindow]);

  useEffect(() => {
    triggerMapTransformUpdate();
  }, [vjState.mapSurfaces, triggerMapTransformUpdate]);

  useEffect(() => {
    window.addEventListener('resize', triggerMapTransformUpdate);
    return () => window.removeEventListener('resize', triggerMapTransformUpdate);
  }, [triggerMapTransformUpdate]);

  const openProjector = () => {
    if (projectorWindow && !projectorWindow.closed) {
      projectorWindow.focus();
      return;
    }
    const w = 1280;
    const h = 720;
    const left = (window.screen.width / 2) - (w / 2);
    const top = (window.screen.height / 2) - (h / 2);
    
    const win = window.open('', 'VJ_Projector', `width=${w},height=${h},top=${top},left=${left}`);
    if (!win) {
      alert("Popup blocked! Please allow popups to use the projector.");
      return;
    }
    win.document.write(`
      <html>
        <head>
          <title>RUSH XR - PROJECTOR</title>
          <style>
            body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
            .absolute { position: absolute; }
            .top-0 { top: 0; }
            .left-0 { left: 0; }
            .pointer-events-none { pointer-events: none; }
            .z-\\[45\\] { z-index: 45; }
            .bg-orange-500\\/80 { background-color: rgba(249, 115, 22, 0.8); }
            .fixed { position: fixed; }
            .inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
          </style>
        </head>
        <body></body>
      </html>
    `);
    win.document.close();
    win.addEventListener('resize', triggerMapTransformUpdate);
    win.addEventListener('beforeunload', () => setProjectorWindow(null));
    
    setProjectorWindow(win);
  };

  useEffect(() => {
    engine.updateMixer(crossfader, masterVol);
  }, [crossfader, masterVol, engine]);

  useEffect(() => {
    const canvas = mixCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()+-~/\\=<>'.split('');
    const corePoints: any[] = [];
    const orbitalPoints: any[] = [];
    let angleX = 0, angleY = 0, ringAngle = 0, smoothedRadius = 0;
    let hueValue = 0;
    let vjParticles: any[] = [];
    let camDrops: Float32Array | null = null;
    
    const initGeometry = () => {
      corePoints.length = 0;
      const numPoints = 1200;
      const phi = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < numPoints; i++) {
          const y = 1 - (i / (numPoints - 1)) * 2;
          const radiusAtY = Math.sqrt(1 - y * y);
          const theta = phi * i; 
          corePoints.push({ x: Math.cos(theta) * radiusAtY, y: y, z: Math.sin(theta) * radiusAtY, char: characters[Math.floor(Math.random() * characters.length)], updateTimer: Math.random() * 100, isRing: false });
      }
    };

    const initOrbitals = () => {
      orbitalPoints.length = 0;
      const density = vjSettings.current.ringDensity;
      for (let i = 0; i < density; i++) {
          let theta = (i / density) * Math.PI * 2;
          orbitalPoints.push({ x: Math.cos(theta), y: (Math.random() - 0.5) * 0.2, z: Math.sin(theta), char: characters[Math.floor(Math.random() * characters.length)], updateTimer: Math.random() * 100, isRing: true, ringType: 1 });
          orbitalPoints.push({ x: Math.cos(theta), y: Math.sin(theta), z: (Math.random() - 0.5) * 0.2, char: characters[Math.floor(Math.random() * characters.length)], updateTimer: Math.random() * 100, isRing: true, ringType: 2 });
      }
    };

    initGeometry();
    initOrbitals();

    const dataArray = new Uint8Array(engine.analyser.frequencyBinCount);

    const visCanvas = document.createElement('canvas');
    const visCtx = visCanvas.getContext('2d')!;

    // --- THREE.JS SHADER PIPELINE SETUP ---
    const threeCanvas = document.createElement('canvas');
    const threeRenderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: false });
    const threeScene = new THREE.Scene();
    const threeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    threeCamera.position.z = 0.5;
    const threeUniforms = {
      u_time: { value: 0.0 },
      u_resolution: { value: new THREE.Vector2() },
      u_audio: { value: 0.0 },
      u_audio_high: { value: 0.0 },
    };
    const threeMaterial = new THREE.ShaderMaterial({
      uniforms: threeUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float u_time;
        uniform vec2 u_resolution;
        uniform float u_audio;
        uniform float u_audio_high;
        varying vec2 vUv;

        // Simple 3D noise and raymarching setup for a trippy visual
        float random(vec2 p) {
            return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;
          uv = uv * 2.0 - 1.0;
          uv.x *= u_resolution.x / u_resolution.y;

          float d = length(uv);
          vec3 col = vec3(0.0);

          float t = u_time * 0.5;
          for(float i = 0.0; i < 4.0; i++) {
             uv = fract(uv * 1.5) - 0.5;
             float d0 = length(uv) * exp(-length(uv));
             vec3 c = vec3(sin(t + i*0.1 + u_audio)*0.5+0.5, 
                           cos(t + i*0.2 - u_audio_high)*0.5+0.5, 
                           sin(t + i*0.3)*0.5+0.5);
             d0 = sin(d0 * 8.0 + t + u_audio*2.0)/8.0;
             d0 = abs(d0);
             d0 = pow(0.01 / d0, 1.2);
             col += c * d0;
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending
    });

    const threeMandelbulbMaterial = new THREE.ShaderMaterial({
      uniforms: threeUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float u_time;
        uniform vec2 u_resolution;
        uniform float u_audio;
        uniform float u_audio_high;
        varying vec2 vUv;

        mat2 rot(float a) {
            float s = sin(a), c = cos(a);
            return mat2(c, -s, s, c);
        }

        float mandelbulb(vec3 pos) {
            vec3 z = pos;
            float dr = 1.0;
            float r = 0.0;
            // audio reactive power
            float power = 8.0 + sin(u_time * 0.2) * 2.0 + u_audio * 5.0;

            for (int i = 0; i < 4; i++) { // Optimized steps
                r = length(z);
                if (r > 2.0) break;
                
                float theta = acos(z.z / r);
                float phi = atan(z.y, z.x);
                dr = pow(r, power - 1.0) * power * dr + 1.0;
                
                float zr = pow(r, power);
                theta = theta * power;
                phi = phi * power;
                
                z = zr * vec3(sin(theta)*cos(phi), sin(phi)*sin(theta), cos(theta));
                z += pos;
            }
            return 0.5 * log(r) * r / dr;
        }

        float map(vec3 p) {
            p.xz *= rot(u_time * 0.2);
            p.xy *= rot(u_time * 0.15 + u_audio);
            return mandelbulb(p);
        }

        vec3 calcNormal(vec3 p) {
            const vec2 e = vec2(0.005, 0.0);
            return normalize(vec3(
                map(p + e.xyy) - map(p - e.xyy),
                map(p + e.yxy) - map(p - e.yxy),
                map(p + e.yyx) - map(p - e.yyx)
            ));
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;
          uv = uv * 2.0 - 1.0;
          uv.x *= u_resolution.x / u_resolution.y;

          vec3 ro = vec3(0.0, 0.0, -2.5 + u_audio_high);
          vec3 rd = normalize(vec3(uv, 1.0));
          
          float dO = 0.0;
          vec3 p;
          float dS;
          
          for(int i=0; i<60; i++) {
              p = ro + rd * dO;
              dS = map(p);
              dO += dS;
              if(dO > 10.0 || dS < 0.002) break;
          }
          
          vec3 col = vec3(0.0);
          
          if(dO < 10.0) {
              vec3 n = calcNormal(p);
              vec3 lightDir = normalize(vec3(1.0, 1.0, -1.0));
              float dif = clamp(dot(n, lightDir), 0.0, 1.0);
              
              vec3 baseCol = vec3(
                  0.5 + 0.5 * sin(u_time + p.x * 2.0 + u_audio * 3.0),
                  0.5 + 0.5 * sin(u_time * 1.2 + p.y * 2.0 + u_audio),
                  0.5 + 0.5 * sin(u_time * 1.4 + p.z * 2.0 + u_audio_high)
              );
              
              col = baseCol * dif + baseCol * 0.2;
              col = mix(col, vec3(0.0), smoothstep(1.5, 4.0, dO)); // Fog
          }
          
          gl_FragColor = vec4(col, col.r + col.g > 0.05 ? 1.0 : 0.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending
    });

    const threePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), threeMaterial);
    threeScene.add(threePlane);
    // ---------------------------------------

    const resize = () => {
      canvas.width = 1920;
      canvas.height = 1080;
      if (visCanvas) {
        visCanvas.width = 1920;
        visCanvas.height = 1080;
      }
      threeRenderer.setSize(1920, 1080);
      threeUniforms.u_resolution.value.set(1920, 1080);
    };
    window.addEventListener('resize', resize);
    resize();

    let currentVisMode = vjSettings.current.activeVisualizer;
    let targetVisMode = currentVisMode;
    let visOpacity = 1.0;
    let activeChaosDensity = 0;
    let currentPaletteMood = '';
    let currentPalette: string[] = [];
    let chaosBoids: any[] = [];

    const generatePalette = (mood: string) => {
        const hueBase = Math.random() * 360;
        switch (mood) {
          case 'NEON': return [`hsl(${hueBase}, 100%, 50%)`, `hsl(${(hueBase + 120)%360}, 100%, 50%)`, `hsl(${(hueBase + 240)%360}, 100%, 50%)`, '#000000', '#ffffff'];
          case 'PASTEL': return [`hsl(${hueBase}, 60%, 85%)`, `hsl(${(hueBase + 40)%360}, 60%, 85%)`, `hsl(${(hueBase + 180)%360}, 50%, 90%)`, '#475569', '#f1f5f9'];
          case 'MOODY': return [`hsl(${hueBase}, 60%, 20%)`, `hsl(${(hueBase + 30)%360}, 50%, 15%)`, '#0f172a', `hsl(${(hueBase + 10)%360}, 70%, 40%)`, '#1e293b'];
          case 'VIBRANT':
          default: return [`hsl(${hueBase}, 80%, 50%)`, `hsl(${(hueBase + 120)%360}, 70%, 45%)`, `hsl(${(hueBase + 240)%360}, 90%, 60%)`, '#1a1a1a', '#f8fafc'];
        }
    }

    const initChaos = (force: boolean = false) => {
        const settings = vjSettings.current;
        if (!force && chaosBoids.length === settings.chaosDensity && currentPaletteMood === settings.paletteMood) {
          return;
        }

        visCtx.fillStyle = settings.paletteMood === 'VIBRANT' ? '#ffffff' : '#000000';
        visCtx.fillRect(0, 0, visCanvas.width, visCanvas.height);
        
        currentPaletteMood = settings.paletteMood;
        currentPalette = generatePalette(currentPaletteMood);
        activeChaosDensity = settings.chaosDensity;
        chaosBoids = [];

        for (let i = 0; i < settings.chaosDensity; i++) {
          chaosBoids.push({
            x: Math.random() * visCanvas.width,
            y: Math.random() * visCanvas.height,
            vx: (Math.random() - 0.5) * 20, 
            vy: (Math.random() - 0.5) * 20,
            color: currentPalette[Math.floor(Math.random() * currentPalette.length)],
            wanderTheta: Math.random() * Math.PI * 2,
            turnSpeed: 0.1 + (Math.random() * 0.2),
            energyPhase: Math.random() * Math.PI * 2,
            energySpeed: 0.01 + (Math.random() * 0.03), 
            maxSurge: 15 + Math.random() * 10,
            currentWidth: 1, 
          });
        }
    };
    
    // Listen for manual regenerate
    const handleChaosRegen = () => initChaos(true);
    window.addEventListener('regenerate-chaos', handleChaosRegen);

    let lastTime = performance.now();

    const renderLoop = () => {
      const safePlayVideo = (vid: HTMLVideoElement) => {
        if (vid.paused && !(vid as any).isPlayPending) {
          (vid as any).isPlayPending = true;
          vid.play()
            .then(() => { (vid as any).isPlayPending = false; })
            .catch((err) => { 
              (vid as any).isPlayPending = false; 
              if (err.name !== 'AbortError') {
                console.error("Video play error:", err);
              }
            });
        }
      };

      try {
        const settings = vjSettings.current;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const fov = 400;
        
        const now = performance.now();
        let dt = (now - lastTime) / 1000.0;
        lastTime = now;
        if (isNaN(dt) || dt < 0) dt = 0.016;
        if (dt > 0.5) dt = 0.5;

        // Timeline playhead and automation evaluation
        const activeTimeline = timelineRef.current;
        if (activeTimeline && activeTimeline.isPlaying) {
          if (activeTimeline.audioSync && engine.deckA && engine.deckA.audio.duration && !engine.deckA.audio.paused) {
            activeTimeline.time = engine.deckA.audio.currentTime % activeTimeline.duration;
          } else {
            activeTimeline.time += dt;
            if (activeTimeline.time >= activeTimeline.duration) {
              if (activeTimeline.loop) {
                activeTimeline.time = activeTimeline.time % activeTimeline.duration;
              } else {
                activeTimeline.time = activeTimeline.duration;
                activeTimeline.isPlaying = false;
                setTimeout(() => {
                  setTimeline(prev => ({ ...prev, isPlaying: false, time: activeTimeline.duration }));
                }, 0);
              }
            }
          }

          // Evaluate track automations
          activeTimeline.tracks.forEach(track => {
            if (track.keyframes.length === 0) return;
            const kfs = [...track.keyframes].sort((a, b) => a.time - b.time);
            const playhead = activeTimeline.time;
            
            let val = track.defaultValue;
            if (playhead <= kfs[0].time) {
              val = kfs[0].value;
            } else if (playhead >= kfs[kfs.length - 1].time) {
              val = kfs[kfs.length - 1].value;
            } else {
              for (let i = 0; i < kfs.length - 1; i++) {
                if (playhead >= kfs[i].time && playhead <= kfs[i + 1].time) {
                  if (track.type === 'discrete') {
                    val = kfs[i].value;
                  } else {
                    const pct = (playhead - kfs[i].time) / (kfs[i + 1].time - kfs[i].time);
                    val = kfs[i].value + pct * (kfs[i + 1].value - kfs[i].value);
                  }
                  break;
                }
              }
            }

            // Apply to active live parameters
            if (track.id === 'track-scale') {
              settings.scale = val;
            } else if (track.id === 'track-chaos') {
              settings.chaosDensity = Math.floor(val);
              if (chaosBoids.length !== settings.chaosDensity) {
                initChaos(false);
              }
            } else if (track.id === 'track-rot') {
              settings.rotationSpeed = val;
            } else if (track.id === 'track-disp') {
              settings.displacement = val;
            } else if (track.id === 'track-cross') {
              // Smooth crossfader sync to mixer elements
              setCrossfader(Math.round(val));
              engine.updateMixer(val, masterVol);
            } else if (track.id === 'track-thresh') {
              settings.threshold = val;
            } else if (track.id === 'track-viz') {
              const intMode = Math.floor(val);
              if (settings.activeVisualizer !== intMode) {
                settings.activeVisualizer = intMode;
                settings.layers.forEach(layer => {
                  if (layer.active && layer.type === 'visualizer') {
                    layer.visualizerMode = intMode;
                  }
                });
              }
            } else if (track.id === 'track-mood') {
              const moods: ('VIBRANT' | 'NEON' | 'PASTEL' | 'MOODY')[] = ['VIBRANT', 'NEON', 'PASTEL', 'MOODY'];
              const mIndex = Math.floor(val);
              const nextMood = moods[mIndex] || 'VIBRANT';
              if (settings.paletteMood !== nextMood) {
                settings.paletteMood = nextMood;
                initChaos(true);
              }
            }
          });
        }

        if (!engine || !engine.analyser) return;

        engine.analyser.getByteFrequencyData(dataArray);
      let bassSum = 0, midSum = 0, highSum = 0;
      for (let i = 0; i < 10; i++) bassSum += dataArray[i];
      for (let i = 10; i < 100; i++) midSum += dataArray[i];
      for (let i = 100; i < 250; i++) highSum += dataArray[i];
      const bassLevel = bassSum / 10;
      const midLevel = midSum / 90;
      const highLevel = highSum / 150;

      const bassNorm = bassLevel / 255.0;
      const midNorm = midLevel / 255.0;
      const highNorm = highLevel / 255.0;
      const isBeat = bassLevel > settings.threshold;
      const time = performance.now();

      // Clear main canvas - Use grey if no layers exist to indicate surface, else black
      const hasActiveLayers = settings.layers.some(l => l.active);
      ctx.fillStyle = settings.paletteMood === 'VIBRANT' ? '#ffffff' : (hasActiveLayers ? '#000000' : '#111111'); 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!hasActiveLayers) {
        // Draw grid overlay so empty projector mapping is visible!
        ctx.save();
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for(let i=0; i<canvas.width; i+=40) { ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); }
        for(let j=0; j<canvas.height; j+=40) { ctx.moveTo(0, j); ctx.lineTo(canvas.width, j); }
        ctx.stroke();
        
        ctx.fillStyle = '#666666';
        ctx.font = '72px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NO LAYERS ACTIVE', canvas.width/2, canvas.height/2);
        ctx.restore();
      }

      // Render Global Video Background
      if (settings.isVideoActive && mediaVideoRef.current && mediaVideoRef.current.readyState >= 2) {
        ctx.save();
        ctx.globalAlpha = settings.videoOpacity !== undefined ? settings.videoOpacity : 0.5;
        const video = mediaVideoRef.current;

        // Manage ping-pong / reverse loop if requested
        if (settings.videoReverseLoop) {
          if (video.loop) {
            video.loop = false;
          }
          const currentDir = settings.videoDirection || 'forward';
          if (currentDir === 'forward') {
            if (settings.isVideoPlaying && video.paused) {
              safePlayVideo(video);
            }
            if (video.currentTime >= video.duration - 0.2 || video.ended) {
              settings.videoDirection = 'backward';
              updateVjSetting('videoDirection', 'backward');
              (video as any).reverseTime = video.currentTime;
              video.pause();
            }
          } else {
            // We only move backwards if it's supposed to be playing!
            if (settings.isVideoPlaying) {
              if (!video.paused) {
                video.pause();
              }
              if ((video as any).reverseTime === undefined || Math.abs((video as any).reverseTime - video.currentTime) > 0.5) {
                (video as any).reverseTime = video.currentTime;
              }
              (video as any).reverseTime -= dt;
              if ((video as any).reverseTime <= 0.05) {
                (video as any).reverseTime = 0;
                video.currentTime = 0;
                settings.videoDirection = 'forward';
                updateVjSetting('videoDirection', 'forward');
                safePlayVideo(video);
              } else {
                if (!video.seeking) {
                  video.currentTime = (video as any).reverseTime;
                }
              }
            }
          }
        } else {
          // Regular loop mode
          if (!video.loop) {
            video.loop = true;
            settings.videoDirection = 'forward';
            updateVjSetting('videoDirection', 'forward');
            if (settings.isVideoPlaying && video.paused) {
              safePlayVideo(video);
            }
          }
        }

        const vW = video.videoWidth;
        const vH = video.videoHeight;
        const scale = Math.max(canvas.width / vW, canvas.height / vH);
        const x = (canvas.width / 2) - (vW / 2) * scale;
        const y = (canvas.height / 2) - (vH / 2) * scale;
        ctx.drawImage(video, x, y, vW * scale, vH * scale);
        ctx.restore();
      }

      // Auto-hue update
      if (settings.autoHue) { 
        hueValue = (hueValue + 0.5) % 360; 
      }

      angleX += settings.rotationSpeed; 
      angleY += settings.rotationSpeed; 
      ringAngle += settings.ringSpeed;

      let baseRadius = window.innerHeight * 0.15 * settings.scale;
      let targetRadius = baseRadius;
      if (isBeat) targetRadius = baseRadius + ((bassLevel - settings.threshold) * settings.displacement * 2.0);
      if (smoothedRadius === 0) smoothedRadius = baseRadius;
      smoothedRadius += (targetRadius - smoothedRadius) * 0.15;

      if (vjParticles.length === 0) {
        vjParticles = Array.from({length: 500}, () => ({
          x: (Math.random() - 0.5) * 1000, y: (Math.random() - 0.5) * 1000, z: (Math.random() - 0.5) * 1000,
          vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
          size: Math.random() * 3 + 1
        }));
      }
      for (let p of vjParticles) {
        p.x += p.vx * (1 + highNorm * 5);
        p.y += p.vy * (1 + highNorm * 5);
        p.z += p.vz * (1 + highNorm * 5);
        const b = 600 * settings.scale;
        if (Math.abs(p.x) > b) p.vx *= -1; 
        if (Math.abs(p.y) > b) p.vy *= -1; 
        if (Math.abs(p.z) > b) p.vz *= -1;
      }

      const project3D = (x: number, y: number, z: number, ax: number, ay: number, az: number = 0, layerFov: number = 400) => {
        let y1 = y * Math.cos(ax) - z * Math.sin(ax);
        let z1 = y * Math.sin(ax) + z * Math.cos(ax);
        let x2 = x * Math.cos(ay) - z1 * Math.sin(ay);
        let z2 = x * Math.sin(ay) + z1 * Math.cos(ay);
        let x3 = x2 * Math.cos(az) - y1 * Math.sin(az);
        let y3 = x2 * Math.sin(az) + y1 * Math.cos(az);
        const scale = layerFov / (layerFov + z2);
        return { px: cx + x3 * scale, py: cy + y3 * scale, pz: z2, scale };
      };

      const drawVisualizer = (mode: number, layerDisp: number, layerFov: number, activeColor: string, alpha: number) => {
        ctx.save();
        ctx.globalAlpha *= alpha;
        
        if (mode === 0) {
          // Wireframe Orbital Globe
          const projected: any[] = [];
          const allPoints = corePoints.concat(orbitalPoints);
          for (let i = 0; i < allPoints.length; i++) {
              const p = allPoints[i]; let px, py, pz;
              if (!p.isRing) {
                  let xy = p.x * Math.cos(angleX) - p.y * Math.sin(angleX), xz = p.x * Math.sin(angleX) + p.y * Math.cos(angleX);
                  let yz = p.z * Math.cos(angleY) - xy * Math.sin(angleY), yy = p.z * Math.sin(angleY) + xy * Math.cos(angleY);
                  px = yz * smoothedRadius; py = xz * smoothedRadius; pz = yy * smoothedRadius;
              } else {
                  let currentRingAngle = (p.ringType === 1) ? ringAngle + midNorm : -ringAngle - midNorm;
                  let rx = p.x * Math.cos(currentRingAngle) - p.z * Math.sin(currentRingAngle), rz = p.x * Math.sin(currentRingAngle) + p.z * Math.cos(currentRingAngle);
                  px = rx * (smoothedRadius*1.8); py = p.y * (smoothedRadius*1.8); pz = rz * (smoothedRadius*1.8);
                  let gy = py * Math.cos(0.5) - pz * Math.sin(0.5), gz = py * Math.sin(0.5) + pz * Math.cos(0.5);
                  py = gy; pz = gz;
              }
              const scaleFactor = layerFov / (layerFov + pz);
              projected.push({ x: cx + (px * scaleFactor), y: cy + (py * scaleFactor), z: pz, scale: scaleFactor, char: p.char, ringType: p.ringType });
          }
          projected.sort((a, b) => b.z - a.z);
          
          ctx.strokeStyle = activeColor;
          ctx.lineWidth = 0.5;
          
          // Draw globe connections
          for (let i = 0; i < projected.length; i+=2) {
             const p1 = projected[i];
             
             // Point rendering
             ctx.fillStyle = activeColor;
             ctx.globalAlpha = alpha * Math.max(0.1, 1 - (p1.z + (smoothedRadius*1.8)) / ((smoothedRadius*1.8) * 2));
             
             if (p1.ringType !== undefined) {
               ctx.font = `${Math.max(4, Math.floor(14 * p1.scale))}px monospace`;
               ctx.fillText(p1.char, p1.x, p1.y);
             } else {
               ctx.beginPath();
               let ptSize = Math.max(1, 2 * p1.scale) + bassNorm * 2;
               ctx.arc(p1.x, p1.y, ptSize, 0, Math.PI * 2);
               if (bassNorm > 0.6) { ctx.shadowBlur = 10; ctx.shadowColor = ctx.fillStyle as string; }
               ctx.fill();
               ctx.shadowBlur = 0;
             }
             
             // Connections
             for (let j = i + 1; j < projected.length && j < i + 12; j++) {
               const p2 = projected[j];
               if (p1.ringType === p2.ringType) {
                 const dx = p1.x - p2.x;
                 const dy = p1.y - p2.y;
                 const dist = dx*dx + dy*dy;
                 if (dist < 4000) {
                    ctx.globalAlpha = alpha * 0.15;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                 }
               }
             }
          }
        } else if (mode === 1) {
          // 3D Audio Terrain (Retro Synthwave Solid Grid)
          const cols = 25; const rows = 25;
          const size = 50 * settings.scale;
          const w = (cols - 1) * size; const h = (rows - 1) * size;
          ctx.lineWidth = 1.5;
          
          type Pt3D = { px: number, py: number, pz: number, scale: number };
          const getPoint = (x: number, y: number): Pt3D => {
            const d = Math.sqrt(Math.pow(x - cols/2, 2) + Math.pow(y - rows/2, 2));
            const dataIdx = Math.floor((d / (cols/2)) * (dataArray.length * 0.4));
            const audioVal = dataArray[dataIdx] / 255.0;
            const px = x * size - w / 2; const pz = y * size - h / 2;
            const py = audioVal * 300 * layerDisp - 150;
            const wave = Math.sin(x * 0.4 + time * 0.002) * 40 * midNorm;
            return project3D(px, py + wave, pz, angleX * 0.3 + Math.PI/5, angleY * 0.3, 0, layerFov);
          };

          // Render back to front
          for (let y = 0; y < rows - 1; y++) {
            for (let x = 0; x < cols - 1; x++) {
              const p1 = getPoint(x, y);
              const p2 = getPoint(x + 1, y);
              const p3 = getPoint(x + 1, y + 1);
              const p4 = getPoint(x, y + 1);

              ctx.beginPath();
              ctx.moveTo(p1.px, p1.py);
              ctx.lineTo(p2.px, p2.py);
              ctx.lineTo(p3.px, p3.py);
              ctx.lineTo(p4.px, p4.py);
              ctx.closePath();
              
              const audioInfluence = dataArray[Math.floor((x/cols)*30)] / 255;
              const lightness = Math.floor(10 + audioInfluence * 20 + y * 2);
              
              ctx.fillStyle = `rgb(${lightness}, ${lightness}, ${lightness + 10})`;
              ctx.fill();

              ctx.strokeStyle = settings.autoHue ? `hsl(${(hueValue + y * 5) % 360}, 100%, 50%)` : activeColor;
              ctx.globalAlpha = alpha * (0.3 + highNorm * 0.7);
              if (isBeat && Math.random() > 0.8) { ctx.shadowBlur = 10; ctx.shadowColor = ctx.strokeStyle as string; }
              ctx.stroke(); 
              ctx.shadowBlur = 0;
            }
          }
        } else if (mode === 2) {
          // 3D Particle Galaxy (Plexus/Constellation)
          const projected = [];
          for (let p of vjParticles) {
            const proj = project3D(p.x, p.y, p.z, angleX, angleY);
            if (proj.pz > -fov + 10) projected.push({ ...proj, size: p.size, original: p });
          }
          projected.sort((a, b) => b.pz - a.pz);
          
          ctx.strokeStyle = activeColor;
          ctx.lineWidth = 1;
          
          for (let i = 0; i < projected.length; i++) {
            const p1 = projected[i];
            
            // Draw connections
            if (i % 2 === 0) { // Limit number of lines for performance
              for (let j = i + 1; j < projected.length && j < i + 15; j++) {
                const p2 = projected[j];
                const dx = p1.px - p2.px;
                const dy = p1.py - p2.py;
                const distSq = dx*dx + dy*dy;
                
                const maxDistStr = 15000 * settings.scale;
                if (distSq < maxDistStr) {
                  const distRatio = 1 - Math.sqrt(distSq) / Math.sqrt(maxDistStr);
                  ctx.globalAlpha = alpha * distRatio * (0.1 + midNorm * 0.5) * Math.max(0, 1 - (p1.pz + 500)/1000);
                  
                  ctx.beginPath();
                  ctx.moveTo(p1.px, p1.py);
                  ctx.lineTo(p2.px, p2.py);
                  ctx.stroke();
                }
              }
            }

            // Draw particle
            ctx.beginPath();
            ctx.arc(p1.px, p1.py, p1.size * p1.scale * (1 + bassNorm * 3), 0, Math.PI * 2);
            ctx.fillStyle = settings.autoHue ? `hsl(${(hueValue + i) % 360}, 100%, 70%)` : activeColor;
            ctx.globalAlpha = alpha * Math.max(0.2, 1 - (p1.pz + 500) / 1000);
            if (bassNorm > 0.6 && Math.random() > 0.9) {
               ctx.shadowBlur = 15 * bassNorm;
               ctx.shadowColor = ctx.fillStyle as string;
            }
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        } else if (mode === 3) {
          // 3D Equalizer Neon Tunnel
          const numRings = 24; const pts = 60;
          const r = 250 * settings.scale;
          ctx.lineWidth = 2 + bassNorm * 3;
          
          for (let i = 0; i < numRings; i++) {
            ctx.beginPath();
            // Create flying effect by modulating y offset with time
            const speed = time * 0.2 * (1 + highNorm);
            const rawY = (i * 40 - speed % 40) - (numRings/2) * 40;
            const audioDataIdx = Math.floor((Math.abs(rawY) / (numRings * 40)) * 64);
            const audio = dataArray[audioDataIdx] / 255;
            
            for (let j = 0; j <= pts; j++) {
              const theta = (j / pts) * Math.PI * 2 + angleX * 0.2 + time * 0.001 * (i%2===0?1:-1);
              const rad = r + audio * 150 * layerDisp;
              
              // Add camera wave
              const waveX = Math.sin(time*0.001 + rawY*0.01) * 100 * midNorm;
              const waveY = Math.cos(time*0.0015 + rawY*0.01) * 100 * midNorm;
              
              const proj = project3D(Math.cos(theta) * rad + waveX, rawY + waveY, Math.sin(theta) * rad, angleX * 0.1, angleY * 0.1);
              if (j === 0) ctx.moveTo(proj.px, proj.py); else ctx.lineTo(proj.px, proj.py);
            }
            
            ctx.strokeStyle = settings.autoHue ? `hsl(${(hueValue + i * 10) % 360}, 100%, ${50 + audio*20}%)` : activeColor;
            
            // Fading based on distance (Z buffer fake)
            const zDist = Math.abs(rawY);
            ctx.globalAlpha = alpha * Math.max(0.05, 1 - zDist / 800);
            
            if (audio > 0.5) {
               ctx.shadowBlur = 10 + audio * 20;
               ctx.shadowColor = ctx.strokeStyle as string;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
            
            // Connect some rings across for a wireframe tunnel look
            if (i > 0 && i % 4 === 0) {
              const prevY = rawY + 160;
              for(let j=0; j<pts; j+=8) {
                const theta = (j / pts) * Math.PI * 2 + angleX * 0.2 + time * 0.001 * (i%2===0?1:-1);
                const p1 = project3D(Math.cos(theta) * (r + audio * 150 * layerDisp), rawY, Math.sin(theta) * (r + audio * 150 * layerDisp), angleX * 0.1, angleY * 0.1);
                const prevAudio = dataArray[audioDataIdx-4] / 255 || 0;
                const thetaPrev = (j / pts) * Math.PI * 2 + angleX * 0.2 + time * 0.001 * ((i-4)%2===0?1:-1);
                const p2 = project3D(Math.cos(thetaPrev) * (r + prevAudio * 150 * layerDisp), prevY, Math.sin(thetaPrev) * (r + prevAudio * 150 * layerDisp), angleX * 0.1, angleY * 0.1);
                ctx.beginPath(); ctx.moveTo(p1.px, p1.py); ctx.lineTo(p2.px, p2.py);
                ctx.globalAlpha = alpha * 0.1;
                ctx.stroke();
              }
            }
          }
        } else if (mode === 4) {
          // Retro Spectrum Analyzer / Digital Rain
          const numBars = 64;
          const barWidth = canvas.width / numBars;
          
          for (let i = 0; i < numBars; i++) {
            const audioVal = dataArray[Math.floor((i / numBars) * 128)] / 255;
            const targetHeight = audioVal * canvas.height * 0.8 * layerDisp;
            
            // Draw blocks of height instead of straight rects
            const blocks = Math.floor(targetHeight / 15);
            ctx.fillStyle = settings.autoHue ? `hsl(${(hueValue + i * 5) % 360}, 100%, 50%)` : activeColor;
            
            for (let b = 0; b < blocks; b++) {
               const yPos = canvas.height - (b * 15) - 10;
               ctx.globalAlpha = alpha * Math.max(0.2, (b / blocks) + 0.1);
               ctx.fillRect(i * barWidth + 2, yPos, barWidth - 4, 10);
            }
            
            // Draw falling peak particles (simulated)
            if (isBeat && Math.random() > 0.8) {
               ctx.globalAlpha = alpha;
               ctx.fillStyle = settings.paletteMood === 'VIBRANT' ? '#000000' : '#ffffff';
               const fallY = (time * 0.2 + i * 20) % canvas.height;
               ctx.fillRect(i * barWidth + Math.random() * barWidth, fallY, 2, Math.random() * 20);
            }
          }
        } else if (mode === 5) {
          // DNA Helix with Base Pairs
          const pts = 120;
          ctx.lineWidth = 2;
          
          const getHelixPoint = (t: number, phaseOffset: number) => {
            const y = (t - 0.5) * canvas.height * 0.8;
            const theta = t * Math.PI * 10 + angleX + phaseOffset;
            const audioEffect = (dataArray[Math.floor(t * 128)] / 255) * 60 * layerDisp;
            const r = 100 * settings.scale + audioEffect;
            return project3D(Math.cos(theta) * r, y, Math.sin(theta) * r, angleX * 0.2, angleY * 0.5);
          };

          for (let s = 0; s < 2; s++) {
            ctx.beginPath();
            const phase = s * Math.PI;
            for (let i = 0; i < pts; i++) {
              const t = i / pts;
              const proj = getHelixPoint(t, phase);
              if (i === 0) ctx.moveTo(proj.px, proj.py); else ctx.lineTo(proj.px, proj.py);
              
              // Draw Base Pairs (Connections between strands)
              if (s === 0 && i % 4 === 0) {
                 const proj2 = getHelixPoint(t, phase + Math.PI);
                 ctx.save();
                 ctx.beginPath();
                 ctx.moveTo(proj.px, proj.py);
                 ctx.lineTo(proj2.px, proj2.py);
                 // Colored base pairs
                 ctx.strokeStyle = settings.autoHue ? `hsl(${(hueValue + i * 10) % 360}, 100%, 60%)` : activeColor;
                 ctx.globalAlpha = alpha * 0.4;
                 if (isBeat) {
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = ctx.strokeStyle;
                 }
                 ctx.stroke();
                 ctx.restore();
                 
                 // Nucleotide particles
                 ctx.beginPath();
                 ctx.arc(proj.px, proj.py, 3, 0, Math.PI*2);
                 ctx.arc(proj2.px, proj2.py, 3, 0, Math.PI*2);
                 ctx.fillStyle = settings.paletteMood === 'VIBRANT' ? '#000000' : '#ffffff';
                 ctx.fill();
              }
            }
            ctx.strokeStyle = activeColor;
            ctx.globalAlpha = alpha * 0.8;
            ctx.stroke();
          }
        } else if (mode === 6) {
          // Chaos Art Engine (Persistent Offscreen Canvas)
          initChaos();

          visCtx.shadowBlur = 2;
          visCtx.shadowColor = "rgba(0,0,0,0.1)";
          visCtx.shadowOffsetY = 1;
          visCtx.shadowOffsetX = 1;

          for (let i = 0; i < chaosBoids.length; i++) {
            const boid = chaosBoids[i];
            const prevX = boid.x;
            const prevY = boid.y;

            const currentChaos = settings.chaosLevel + midNorm * layerDisp * 0.5;

            boid.wanderTheta += (Math.random() - 0.5) * (currentChaos * 2);
            boid.energyPhase += boid.energySpeed + (bassNorm * 0.1 * layerDisp);
            
            const surgeFactor = (Math.sin(boid.energyPhase) + 1) / 2; 
            const currentLimit = 0.5 + (surgeFactor * boid.maxSurge * (1 + bassNorm * layerDisp));

            const thrustX = Math.cos(boid.wanderTheta);
            const thrustY = Math.sin(boid.wanderTheta);

            boid.vx += thrustX * 0.5;
            boid.vy += thrustY * 0.5;

            boid.vx *= 0.95;
            boid.vy *= 0.95;

            const currentSpeed = Math.sqrt(boid.vx * boid.vx + boid.vy * boid.vy);
            if (currentSpeed > currentLimit) {
              boid.vx = (boid.vx / currentSpeed) * currentLimit;
              boid.vy = (boid.vy / currentSpeed) * currentLimit;
            }

            boid.x += boid.vx;
            boid.y += boid.vy;

            if (boid.x < 0 || boid.x > visCanvas.width) { boid.vx *= -1; boid.wanderTheta += Math.PI; }
            if (boid.y < 0 || boid.y > visCanvas.height) { boid.vy *= -1; boid.wanderTheta += Math.PI; }

            if (currentSpeed > 0.1) {
              const targetWidth = Math.max(0.5, Math.pow(7 / currentSpeed, 1.3) * (1 + bassNorm * 2 * layerDisp));
              boid.currentWidth = boid.currentWidth + (targetWidth - boid.currentWidth) * 0.1;

              visCtx.beginPath();
              visCtx.moveTo(prevX, prevY);
              visCtx.lineTo(boid.x, boid.y);
              visCtx.strokeStyle = settings.autoHue ? `hsl(${(hueValue + i * 5) % 360}, 100%, 50%)` : boid.color;
              visCtx.lineWidth = boid.currentWidth * settings.scale;
              visCtx.lineCap = 'round';
              visCtx.lineJoin = 'round';
              visCtx.stroke();

              const splatChance = settings.splatFrequency * 0.05 * (1 + highNorm * layerDisp);
              if ((currentSpeed < 2 || currentSpeed > 10) && Math.random() < splatChance) {
                 const angle = Math.random() * Math.PI * 2;
                 const distance = (Math.random() * boid.currentWidth * 2) + (currentSpeed * 2);
                 const dropX = boid.x + Math.cos(angle) * distance;
                 const dropY = boid.y + Math.sin(angle) * distance;
                 
                 visCtx.beginPath();
                 const radius = (Math.random() * boid.currentWidth * 0.5) + 0.5 + (bassNorm * 3 * layerDisp); 
                 visCtx.arc(dropX, dropY, radius, 0, Math.PI * 2);
                 visCtx.fillStyle = settings.autoHue ? `hsl(${(hueValue + i * 5) % 360}, 100%, 50%)` : boid.color;
                 visCtx.fill();
              }
            }
          }

          if (isBeat && Math.random() > 0.98) {
             visCtx.fillStyle = settings.paletteMood === 'VIBRANT' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
             visCtx.fillRect(0, 0, visCanvas.width, visCanvas.height);
          }

          ctx.drawImage(visCanvas, 0, 0);
        } else if (mode === 7 || mode === 8) {
          try {
             threePlane.material = mode === 8 ? threeMandelbulbMaterial : threeMaterial;
             threeUniforms.u_time.value = time * 0.001;
             threeUniforms.u_audio.value = bassNorm * layerDisp;
             threeUniforms.u_audio_high.value = highNorm * layerDisp;
             threeRenderer.render(threeScene, threeCamera);
             ctx.drawImage(threeCanvas, 0, 0);
          } catch(err) {
             console.error("ThreeJS Error:", err);
          }
        }
        ctx.restore();
      };

      // Render each layer
      settings.layers.forEach(layer => {
        if (!layer.active) return;

        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode === 'additive' as any ? 'lighter' : layer.blendMode;

        const layerFov = layer.perspective || 400;

        // Apply Layer Transformations (Mapping / Distortion)
        const getAudioVal = (type: string) => {
          if (type === 'bass') return bassNorm;
          if (type === 'mid') return midNorm;
          if (type === 'high') return highNorm;
          return 0;
        };

        const sc = layer.scale * (1 + getAudioVal(layer.mapping?.scale || 'none') * settings.displacement * 0.5);
        const rot = (layer.rotation + getAudioVal(layer.mapping?.rotation || 'none') * 180 * settings.displacement) * (Math.PI / 180);
        const op = Math.min(1, layer.opacity + getAudioVal(layer.mapping?.opacity || 'none') * 0.5);
        const sX = layer.skewX * (Math.PI / 180);
        const sY = layer.skewY * (Math.PI / 180);
        const tX = layer.offsetX;
        const tY = layer.offsetY;
        const layerDisp = settings.displacement * (1 + getAudioVal(layer.mapping?.displacement || 'none'));

        ctx.globalAlpha = op;
        ctx.translate(canvas.width/2 + tX, canvas.height/2 + tY);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        ctx.transform(1, Math.tan(sY), Math.tan(sX), 1, 0, 0);
        ctx.translate(-canvas.width/2, -canvas.height/2);

        let activeColor = settings.color;
        if (settings.autoHue) { 
          activeColor = `hsl(${hueValue}, 100%, 50%)`; 
        }

        if (layer.type === 'video') {
          const video = videoCache.current.get(layer.id);
          if (video && video.readyState >= 2) {
            const vW = video.videoWidth;
            const vH = video.videoHeight;
            const scale = Math.max(canvas.width / vW, canvas.height / vH);
            const x = (canvas.width / 2) - (vW / 2) * scale;
            const y = (canvas.height / 2) - (vH / 2) * scale;
            ctx.drawImage(video, x, y, vW * scale, vH * scale);
          }
        } else if (layer.type === 'camera' && cameraVideoRef.current && cameraVideoRef.current.readyState >= 2 && segmentationCanvasRef.current) {
          const video = cameraVideoRef.current;
          const segCanvas = segmentationCanvasRef.current;
          segCanvas.width = video.videoWidth;
          segCanvas.height = video.videoHeight;
          const segCtx = segCanvas.getContext('2d');
          if (segCtx) {
            segCtx.fillStyle = 'black';
            segCtx.fillRect(0, 0, segCanvas.width, segCanvas.height);

            const startTimeMs = performance.now();
            let faceResult = (window as any).faceResult;
            let handResult = (window as any).handResult;
            
            if (video.currentTime !== (window as any).lastVideoTime) {
              (window as any).lastVideoTime = video.currentTime;
              if ((window as any).faceLandmarker) faceResult = (window as any).faceLandmarker.detectForVideo(video, startTimeMs);
              if ((window as any).handLandmarker) handResult = (window as any).handLandmarker.detectForVideo(video, startTimeMs);
              (window as any).faceResult = faceResult;
              (window as any).handResult = handResult;
            }

            const drawingUtils = new DrawingUtils(segCtx);
            segCtx.save();
            segCtx.translate(segCanvas.width, 0);
            segCtx.scale(-1, 1);

            if (faceResult?.faceLandmarks) {
              for (const landmarks of faceResult.faceLandmarks) {
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: activeColor, lineWidth: 1 });
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: activeColor, lineWidth: 1.5 });
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: activeColor, lineWidth: 1.5 });
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: activeColor, lineWidth: 1.5 });
              }
            }

            if (handResult?.landmarks) {
              for (const landmarks of handResult.landmarks) {
                drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: activeColor, lineWidth: 2 });
                drawingUtils.drawLandmarks(landmarks, { color: activeColor, lineWidth: 1, radius: 2 });
              }
            }
            segCtx.restore();

            ctx.save();
            ctx.globalAlpha = layer.opacity;
            const targetColor = activeColor;
            
            const scale = Math.max(canvas.width / segCanvas.width, canvas.height / segCanvas.height);
            const w = segCanvas.width * scale;
            const h = segCanvas.height * scale;
            
            // Output pure color wireframe onto the original context
            ctx.drawImage(segCanvas, -w/2, -h/2, w, h);
            ctx.restore();
          }
        } else if (layer.type === 'visualizer') {
          if (layer.transitionFactor < 1) {
            layer.transitionFactor += dt * 2;
            if (layer.transitionFactor > 1) layer.transitionFactor = 1;
          }

          if (layer.transitionFactor < 1 && layer.prevVisualizerMode !== undefined) {
            drawVisualizer(layer.prevVisualizerMode, layerDisp, layerFov, activeColor, 1 - layer.transitionFactor);
            drawVisualizer(layer.visualizerMode, layerDisp, layerFov, activeColor, layer.transitionFactor);
          } else {
            drawVisualizer(layer.visualizerMode, layerDisp, layerFov, activeColor, 1);
          }
        }
        ctx.restore();
      });

      if (settings.customMask && settings.customMask.active && !settings.isMaskingActive) {
        if (settings.customMask.type === 'circle' && settings.customMask.circleX !== undefined && settings.customMask.circleY !== undefined && settings.customMask.circleRadius !== undefined) {
           ctx.save();
           ctx.beginPath();
           // use width for simpler logic
           ctx.arc(settings.customMask.circleX * canvas.width, settings.customMask.circleY * canvas.height, settings.customMask.circleRadius * canvas.width, 0, Math.PI * 2);
           ctx.globalCompositeOperation = settings.customMask.invert ? 'destination-out' : 'destination-in';
           ctx.fillStyle = 'rgba(0,0,0,1)';
           ctx.fill();
           ctx.restore();
        } else if (settings.customMask.type !== 'circle' && settings.customMask.points.length > 2) {
           ctx.save();
           ctx.beginPath();
           settings.customMask.points.forEach((p, i) => {
             if (i === 0) ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
             else ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
           });
           ctx.closePath();
          
           ctx.globalCompositeOperation = settings.customMask.invert ? 'destination-out' : 'destination-in';
           ctx.fillStyle = 'rgba(0,0,0,1)';
           ctx.fill();
           ctx.restore();
        }
      }

      if (settings.isMaskingActive) {
         ctx.save();
         ctx.globalCompositeOperation = 'source-over';
         ctx.strokeStyle = '#f97316';
         ctx.lineWidth = 2;
         if (settings.customMask.type === 'circle') {
            // Circle overlay is handled by UI divs
         } else {
             ctx.beginPath();
             settings.customMask.points.forEach((p, i) => {
               if (i === 0) ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
               else ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
             });
             
             if (settings.customMask.points.length >= 2) {
                ctx.setLineDash([5, 5]);
                ctx.lineTo(settings.customMask.points[0].x * canvas.width, settings.customMask.points[0].y * canvas.height);
                ctx.stroke();
                ctx.setLineDash([]);
             } else if (settings.customMask.points.length > 0) {
                ctx.stroke();
             }

             settings.customMask.points.forEach((p) => {
               ctx.beginPath();
               ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
               ctx.fillStyle = '#f97316';
               ctx.fill();
             });
         }
         ctx.restore();
      }

      if (queuePreviewCanvasRef.current && canvas.width > 0) {
        if (queuePreviewCanvasRef.current.width !== canvas.width) { queuePreviewCanvasRef.current.width = canvas.width; }
        if (queuePreviewCanvasRef.current.height !== canvas.height) { queuePreviewCanvasRef.current.height = canvas.height; }
        const qCtx = queuePreviewCanvasRef.current.getContext('2d');
        if (qCtx) {
           qCtx.clearRect(0,0, canvas.width, canvas.height);
           qCtx.drawImage(canvas, 0, 0);
        }
      }
      
      if (mappingRawPreviewCanvasRef.current && canvas.width > 0) {
        if (mappingRawPreviewCanvasRef.current.width !== canvas.width) { mappingRawPreviewCanvasRef.current.width = canvas.width; }
        if (mappingRawPreviewCanvasRef.current.height !== canvas.height) { mappingRawPreviewCanvasRef.current.height = canvas.height; }
        const mCtx = mappingRawPreviewCanvasRef.current.getContext('2d');
        if (mCtx) {
           mCtx.clearRect(0,0, canvas.width, canvas.height);
           mCtx.drawImage(canvas, 0, 0);
        }
      }

      vjSettings.current.mapSurfaces.forEach(surf => {
        const sCanvas = surfaceCanvasesRef.current[surf.id];
        if (sCanvas) {
          let dimsChanged = false;
          if (sCanvas.width !== canvas.width) { sCanvas.width = canvas.width; dimsChanged = true; }
          if (sCanvas.height !== canvas.height) { sCanvas.height = canvas.height; dimsChanged = true; }
          const sCtx = sCanvas.getContext('2d');
          if (sCtx) {
             sCtx.clearRect(0, 0, sCanvas.width, sCanvas.height);
             sCtx.drawImage(canvas, 0, 0);
          }
          if (dimsChanged) setTimeout(triggerMapTransformUpdate, 0);
        }

        const pCanvas = projSurfaceCanvasesRef.current[surf.id];
        if (pCanvas) {
          let pDimsChanged = false;
          if (pCanvas.width !== canvas.width) { pCanvas.width = canvas.width; pDimsChanged = true; }
          if (pCanvas.height !== canvas.height) { pCanvas.height = canvas.height; pDimsChanged = true; }
          const pCtx = pCanvas.getContext('2d');
          if (pCtx) {
             pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
             pCtx.drawImage(canvas, 0, 0);
          }
          if (pDimsChanged) setTimeout(triggerMapTransformUpdate, 0);
        }
      });
      } catch (e) {
        console.error("Render loop error:", e);
      } finally {
        animationFrameId = requestAnimationFrame(renderLoop);
      }
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('regenerate-chaos', handleChaosRegen);
    };
  }, [engine]);

  const onQueueDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files) as File[];
    const audioFiles = files.filter(f => f.type.startsWith('audio/'));
    const newItems = audioFiles.map(f => ({ id: Math.random().toString(36).substr(2, 9), file: f, name: f.name }));
    setQueue(q => [...q, ...newItems]);
  };

  const toggleRecording = () => {
    if (!isRecording) {
      const dest = engine.ctx.createMediaStreamDestination();
      engine.masterGain.connect(dest);
      const recorder = new MediaRecorder(dest.stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } else {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `RUSH_XR_MIX_${new Date().getTime()}.webm`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 100);
        };
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    }
  };

  return (
    <div className="app-grid bg-[#121212] text-zinc-200 font-sans" style={{ '--h-bottom': bottomPanelTab === 'timeline' ? '300px' : 'clamp(10rem, 18vh, 14rem)' } as React.CSSProperties}>
      {/* Hidden Master Mix Canvas */}
      <canvas ref={mixCanvasRef} className="fixed top-0 left-0 opacity-0 pointer-events-none -z-50" />
      <video ref={cameraVideoRef} className="fixed top-0 left-0 opacity-0 pointer-events-none -z-50" autoPlay playsInline muted />
      <video 
        ref={mediaVideoRef} 
        src={vjState.videoSrc || undefined} 
        className="fixed top-0 left-0 opacity-0 pointer-events-none -z-50" 
        playsInline 
        muted 
        loop={!vjState.videoReverseLoop} 
        crossOrigin="anonymous" 
        onCanPlay={(e) => {
          const video = e.currentTarget;
          if (vjState.isVideoPlaying) {
            video.play().catch(err => {
              if (err.name !== 'AbortError') {
                console.error("Video play error on canplay:", err);
              }
            });
          }
        }}
      />
      <canvas ref={segmentationCanvasRef} className="fixed top-0 left-0 opacity-0 pointer-events-none -z-50" />

      {/* Rendered Surfaces Projector Portals */}
      {vjState.mapSurfaces.map(surf => (
        <React.Fragment key={`portal-${surf.id}`}>
          {projectorWindow && createPortal(
            <>
              <canvas ref={(el) => { if(el) projSurfaceCanvasesRef.current[surf.id] = el; }} className="absolute top-0 left-0 pointer-events-none" />
              {vjState.isMappingActive && (
                <div className="fixed inset-0 pointer-events-none z-[45]">
                  <div className="absolute bg-orange-500/80 pointer-events-none" style={{ left: 0, right: 0, top: mousePos.y * (projectorWindow.innerHeight / window.innerHeight), height: '1px' }} />
                  <div className="absolute bg-orange-500/80 pointer-events-none" style={{ top: 0, bottom: 0, left: mousePos.x * (projectorWindow.innerWidth / window.innerWidth), width: '1px' }} />
                </div>
              )}
            </>,
            projectorWindow.document.body
          )}
        </React.Fragment>
      ))}

      {/* Crosshair when Mapping (Main UI) */}
      {vjState.isMappingActive && (
        <div className="fixed inset-0 pointer-events-none z-[55]">
          <div className="absolute bg-orange-500/80 pointer-events-none shadow-[0_0_8px_rgba(255,94,0,0.8)]" style={{ left: 0, right: 0, top: mousePos.y, height: '1px' }} />
          <div className="absolute bg-orange-500/80 pointer-events-none shadow-[0_0_8px_rgba(255,94,0,0.8)]" style={{ top: 0, bottom: 0, left: mousePos.x, width: '1px' }} />
        </div>
      )}

      {/* Masking UI (Interactive) */}
      {vjState.isMaskingActive && vjState.customMask.type === 'circle' && (
         <div className="absolute inset-0 z-40 bg-black/50" onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const circleX = (e.clientX - rect.left) / rect.width;
            const circleY = (e.clientY - rect.top) / rect.height;
            updateVjSetting('customMask', { ...vjSettings.current.customMask, circleX, circleY, circleRadius: vjSettings.current.customMask.circleRadius || 0.25 });
         }}>
           {vjState.customMask.circleX !== undefined && vjState.customMask.circleRadius !== undefined && (
             <div className="absolute border border-dashed border-orange-500 rounded-full" style={{
                left: `calc(${vjState.customMask.circleX! * 100}% - ${vjState.customMask.circleRadius! * 100}%)`,
                top: `calc(${vjState.customMask.circleY! * 100}% - ${vjState.customMask.circleRadius! * 100 * (16/9)}%)`, // adjust for aspect ratio in CSS top% (it relies on height)
                width: `${vjState.customMask.circleRadius! * 200}%`,
                aspectRatio: '1',
                pointerEvents: 'none'
             }} />
           )}
           <div className="absolute top-[10vh] left-1/2 -translate-x-1/2 panel-frame px-4 py-2 text-fluid-sm font-mono text-orange-500 pointer-events-none text-center shadow-lg uppercase font-bold tracking-widest">
             Circle Mask Tool Active<br/>
             <span className="text-zinc-500 text-fluid-sm font-normal">Click to place • Use bottom sliders to scale</span>
           </div>
           <div className="absolute bottom-[10vh] left-1/2 -translate-x-1/2 w-[clamp(18rem,40vw,30rem)] max-w-full flex flex-col gap-4 pointer-events-auto panel-frame p-4 shadow-2xl">
              <Slider label="Radius" min={0.01} max={2} step={0.01} value={vjState.customMask.circleRadius || 0.25} onChange={(v: number) => updateVjSetting('customMask', { ...vjState.customMask, circleRadius: v })} />
              <div className="flex gap-4">
                <button 
                  onClick={(e) => {
                     e.stopPropagation();
                     updateVjSetting('customMask', { ...vjSettings.current.customMask, invert: !vjSettings.current.customMask.invert });
                  }}
                  className={`flex-1 px-4 py-2 text-fluid-sm font-mono tracking-widest uppercase transition-colors font-bold ${vjState.customMask.invert ? 'bg-zinc-800 text-white border border-zinc-700' : 'bg-orange-600 text-black border border-orange-500'}`}
                >
                  MODE: {vjSettings.current.customMask.invert ? 'OUTSIDE MASK (CUT)' : 'INSIDE MASK (KEEP)'}
                </button>
                <button 
                  onClick={(e) => {
                     e.stopPropagation();
                     updateVjSetting('customMask', { ...vjSettings.current.customMask, circleX: undefined, circleY: undefined, circleRadius: undefined });
                  }}
                  className="bg-zinc-900 border border-red-900/40 text-red-500 px-4 py-2 hover:bg-zinc-800 hover:border-red-500 text-fluid-sm font-mono uppercase tracking-widest font-bold transition-colors"
                >
                  CLEAR
                </button>
                <button 
                  onClick={(e) => {
                     e.stopPropagation();
                     updateVjSetting('isMaskingActive', false);
                  }}
                  className="bg-orange-500 text-black px-6 py-2 text-fluid-sm hover:bg-orange-400 font-mono font-bold uppercase tracking-widest transition-colors"
                >
                  DONE
                </button>
              </div>
           </div>
         </div>
      )}

      {vjState.isMaskingActive && vjState.customMask.type === 'polygon' && (
        <div className="contents">
          <div className="absolute top-[10vh] left-1/2 -translate-x-1/2 panel-frame px-4 py-2 text-fluid-sm font-mono text-orange-500 pointer-events-none text-center shadow-lg uppercase font-bold tracking-widest z-50">
            Mask Pen Tools Active<br/>
            <span className="text-zinc-500 text-fluid-sm font-normal">Click to draw • Press ENTER to apply • P to toggle • BACKSPACE to undo</span>
          </div>
          <div className="absolute bottom-[10vh] left-1/2 -translate-x-1/2 flex gap-4 pointer-events-auto panel-frame p-2 shadow-2xl z-50">
            <button 
              onClick={(e) => {
                 e.stopPropagation();
                 updateVjSetting('customMask', { ...vjSettings.current.customMask, invert: !vjSettings.current.customMask.invert });
              }}
              className={`px-4 py-2 text-fluid-sm font-mono tracking-widest uppercase transition-colors font-bold ${vjSettings.current.customMask.invert ? 'bg-zinc-800 text-white border border-zinc-700' : 'bg-orange-600 text-black border border-orange-500'}`}
            >
              MODE: {vjSettings.current.customMask.invert ? 'OUTSIDE MASK (CUT)' : 'INSIDE MASK (KEEP)'}
            </button>
            <button 
              onClick={(e) => {
                 e.stopPropagation();
                 updateVjSetting('customMask', { ...vjSettings.current.customMask, points: [] });
              }}
              className="bg-zinc-900 border border-red-900/40 text-red-500 px-4 py-2 hover:bg-zinc-800 hover:border-red-500 text-fluid-sm font-mono uppercase tracking-widest font-bold transition-colors"
            >
              CLEAR
            </button>
            <button 
              onClick={(e) => {
                 e.stopPropagation();
                 updateVjSetting('isMaskingActive', false);
              }}
              className="bg-orange-500 text-black px-6 py-2 text-fluid-sm hover:bg-orange-400 font-mono font-bold uppercase tracking-widest transition-colors"
            >
              DONE
            </button>
          </div>
        </div>
      )}

      {/* Overlay UI Layer */}
      <div className="contents pointer-events-none">
        
        {/* Header */}
        <header className="p-3 panel-frame border-b border-[#27272a] flex justify-between items-center pointer-events-auto shrink-0 font-mono" style={{ gridArea: 'header' }}>
          <div className="flex items-center gap-4">
            <span className="orbitron font-bold text-fluid-2xl text-orange-500 tracking-widest" style={{ textShadow: '0 0 5px rgba(255,94,0,0.5)' }}>
              RUSH <span className="text-zinc-100">XR</span>
            </span>
            <div className="h-6 w-px bg-zinc-800"></div>
            <span className="text-fluid-sm text-zinc-500 tracking-widest uppercase">System Uplink Active</span>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                const newType = 'polygon';
                if (!vjState.isMaskingActive || vjState.customMask.type !== newType) {
                   updateVjSetting('isMaskingActive', true);
                   updateVjSetting('customMask', { ...vjState.customMask, type: newType });
                } else {
                   updateVjSetting('isMaskingActive', false);
                }
              }}
              className={`px-3 py-1.5 border text-fluid-sm font-bold uppercase transition-colors flex items-center justify-center ${vjState.isMaskingActive && vjState.customMask.type === 'polygon' ? 'bg-orange-600 text-white border-orange-500' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-orange-500 hover:bg-orange-500/10 hover:text-orange-500'}`}
              title="Pen Mask Tool (P)"
            >
              <PenTool size={14} />
            </button>
            <button 
              onClick={() => {
                const newType = 'circle';
                if (!vjState.isMaskingActive || vjState.customMask.type !== newType) {
                   updateVjSetting('isMaskingActive', true);
                   updateVjSetting('customMask', { ...vjState.customMask, type: newType });
                } else {
                   updateVjSetting('isMaskingActive', false);
                }
              }}
              className={`px-3 py-1.5 border text-fluid-sm font-bold uppercase transition-colors flex items-center justify-center ${vjState.isMaskingActive && vjState.customMask.type === 'circle' ? 'bg-orange-600 text-white border-orange-500' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-orange-500 hover:bg-orange-500/10 hover:text-orange-500'}`}
              title="Circle Mask Tool"
            >
              <Circle size={14} />
            </button>
            <button 
              onClick={() => setShowLegend(true)}
              className="px-2 py-1.5 border border-zinc-700 text-fluid-sm font-bold uppercase transition-colors flex items-center justify-center bg-zinc-900 text-zinc-300 hover:border-orange-500 hover:bg-orange-500/10 hover:text-orange-500"
              title="Keyboard Shortcuts (?)"
            >
              <kbd className="font-mono">?</kbd>
            </button>
            <button 
              onClick={openProjector}
              className="px-4 py-1.5 border border-zinc-700 text-fluid-sm font-bold uppercase transition-colors flex items-center gap-2 tracking-widest bg-zinc-900 text-zinc-300 hover:border-orange-500 hover:bg-orange-500/10 hover:text-orange-500"
            >
              <Monitor size={12} />
              Projector Display
            </button>
            <button 
              onClick={toggleRecording}
              className={`px-4 py-1.5 border text-fluid-sm font-bold uppercase transition-colors flex items-center gap-2 tracking-widest ${isRecording ? 'bg-red-600 text-white border-red-500' : 'bg-zinc-900 text-red-500 border-red-900/50 hover:border-red-500 hover:bg-red-900/20'}`}
            >
              <div className={`w-2 h-2 ${isRecording ? 'bg-white animate-pulse' : 'bg-red-500'}`}></div>
              {isRecording ? 'Recording...' : 'REC OUT'}
            </button>
          </div>
        </header>

        {/* Main Content Area */}
          
        {/* Left Sidebar: VJ Controls */}
        <div className="flex pointer-events-auto h-full shadow-2xl z-50" style={{ gridArea: 'left', minHeight: 0 }}>
          <VJPanel 
            vjState={vjState} 
            updateVjSetting={updateVjSetting} 
            updateLayer={updateLayer}
            addLayer={addLayer}
            removeLayer={removeLayer}
            cameraVideoRef={cameraVideoRef} 
            mediaVideoRef={mediaVideoRef} 
          />
        </div>

        {/* Center Area: Workspace for Map & Output */}
        <div 
          className="overflow-hidden relative group outline-none bg-black ring-1 ring-zinc-800/50 m-2 rounded pointer-events-auto"
          style={{ gridArea: 'center', minHeight: 0 }}
          onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setWorkspaceZoom(z => Math.max(0.1, Math.min(5, z - e.deltaY * 0.01)));
              } else {
                setWorkspacePan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
              }
            }}
            tabIndex={0}
          >
            <div className="absolute right-4 top-1/2 -translate-y-1/2 z-50 h-[clamp(12rem,20vh,20rem)] flex flex-col items-center gap-4 panel-frame p-2 rounded-full pointer-events-auto shadow-2xl">
                 <button onClick={() => setWorkspaceZoom(z => Math.min(5, z + 0.1))} className="text-zinc-500 hover:text-white font-bold">+</button>
                 <input 
                   type="range" 
                   min="0.1" 
                   max="5" 
                   step="0.01" 
                   value={workspaceZoom}
                   onChange={e => setWorkspaceZoom(parseFloat(e.target.value))}
                   className="flex-1 cursor-pointer w-2 outline-none slider-vertical accent-orange-500"
                   style={{ WebkitAppearance: 'slider-vertical' } as any}
                 />
                 <button onClick={() => setWorkspaceZoom(z => Math.max(0.1, z - 0.1))} className="text-zinc-500 hover:text-white font-bold">-</button>
                 <button onClick={() => { setWorkspaceZoom(1); setWorkspacePan({x:0, y:0}); }} className="mt-2 text-fluid-xs font-bold text-orange-500 uppercase flex flex-col items-center"><span>RST</span></button>
            </div>

            <div 
               className="absolute top-1/2 left-1/2 pointer-events-none"
               style={{ 
                  aspectRatio: '16/9',
                  width: '10000px',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  transform: `translate(calc(-50% + ${workspacePan.x}px), calc(-50% + ${workspacePan.y}px)) scale(${workspaceZoom})`, 
                  transition: 'transform 0.1s ease-out'
               }}
               ref={workspaceRef}
            >
                {/* Visualizer Background Grid / Reticle */}
                <div className="absolute inset-0 pointer-events-none opacity-20" style={{
                   backgroundImage: 'linear-gradient(to right, #444 1px, transparent 1px), linear-gradient(to bottom, #444 1px, transparent 1px)',
                   backgroundSize: '40px 40px'
                }}></div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
                  <div className="w-full h-px bg-white/20 absolute top-1/2"></div>
                  <div className="h-full w-px bg-white/20 absolute left-1/2"></div>
                  <div className="w-[clamp(15rem,30vw,25rem)] h-[clamp(15rem,30vw,25rem)] rounded-full border border-white/20 absolute mix-blend-screen"></div>
                  <div className="w-[clamp(4rem,8vw,6rem)] h-[clamp(4rem,8vw,6rem)] rounded-full border border-white/10 absolute mix-blend-screen"></div>
                </div>

                {/* Raw Main Output Source (so user knows what is being mapped) */}
                <canvas ref={mappingRawPreviewCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-40 border border-zinc-800" />

                {/* Rendered Surfaces */}
                {vjState.mapSurfaces.map(surf => (
                  <div key={surf.id} className="absolute inset-0 z-0 pointer-events-none opacity-100">
                    <canvas ref={(el) => { if(el) surfaceCanvasesRef.current[surf.id] = el; }} className="absolute top-0 left-0 pointer-events-none border-2 border-green-500 bg-red-500/20" />
                  </div>
                ))}

                {/* Mapping Nodes (Interactive) */}
                {vjState.isMappingActive && vjState.mapSurfaces.map(surf => (
                  <React.Fragment key={`nodes-${surf.id}`}>
                    {surf.points.map((pt, i) => (
                      <div
                        key={`${surf.id}-pt${i}`}
                        className={`absolute w-10 h-10 border-4 rounded-full cursor-crosshair z-50 pointer-events-auto ${vjState.activeMapSurfaceId === surf.id ? 'bg-orange-500/50 border-orange-500' : 'bg-blue-500/50 border-blue-500'}`}
                        style={{
                          left: `${pt.x * 100}%`, top: `${pt.y * 100}%`,
                          transform: `translate(-50%, -50%) scale(${1 / workspaceZoom})`,
                          boxShadow: vjState.activeMapSurfaceId === surf.id ? '0 0 20px #ff4500' : 'none'
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          if (vjState.activeMapSurfaceId !== surf.id) {
                              updateVjSetting('activeMapSurfaceId', surf.id);
                          }
                          const onMouseMove = (moveEvent: MouseEvent) => {
                            if (!workspaceRef.current) return;
                            const rect = workspaceRef.current.getBoundingClientRect();
                            // Normalized coordinates 0..1
                            const x = (moveEvent.clientX - rect.left) / rect.width;
                            const y = (moveEvent.clientY - rect.top) / rect.height;
                            
                            const newSurfaces = [...vjSettings.current.mapSurfaces];
                            const targetSurf = newSurfaces.find(s => s.id === surf.id);
                            if (targetSurf) {
                              targetSurf.points[i] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
                              updateVjSetting('mapSurfaces', newSurfaces);
                            }
                          };
                          const onMouseUp = () => {
                            window.removeEventListener('mousemove', onMouseMove);
                            window.removeEventListener('mouseup', onMouseUp);
                          };
                          window.addEventListener('mousemove', onMouseMove);
                          window.addEventListener('mouseup', onMouseUp);
                        }}
                      />
                    ))}
                  </React.Fragment>
                ))}

                {/* Masking Polygon Nodes (Interactive) */}
                {vjState.isMaskingActive && vjState.customMask.type === 'polygon' && (
                  <div 
                    className="absolute inset-0 z-40 cursor-crosshair pointer-events-auto"
                    onClick={(e) => {
                      if (isDraggingRef.current) return;
                      if (!workspaceRef.current) return;
                      const rect = workspaceRef.current.getBoundingClientRect();
                      const x = (e.clientX - rect.left) / rect.width;
                      const y = (e.clientY - rect.top) / rect.height;
                      
                      const currentPts = vjSettings.current.customMask.points;
                      let insertIndex = -1;
                      let minD = Infinity;

                      const ptPx = { x: x * rect.width, y: y * rect.height };
                      
                      const distSqToSegment = (p: {x: number, y: number}, p1: {x: number, y: number}, p2: {x: number, y: number}) => {
                        const l2 = (p1.x - p2.x)**2 + (p1.y - p2.y)**2;
                        if (l2 === 0) return (p.x - p1.x)**2 + (p.y - p1.y)**2;
                        let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
                        t = Math.max(0, Math.min(1, t));
                        return (p.x - (p1.x + t * (p2.x - p1.x)))**2 + (p.y - (p1.y + t * (p2.y - p1.y)))**2;
                      };

                      for (let i = 0; i < currentPts.length; i++) {
                        if (currentPts.length <= 2 && i === currentPts.length - 1) break;
                        const p1 = { x: currentPts[i].x * rect.width, y: currentPts[i].y * rect.height };
                        const p2 = { x: currentPts[(i + 1) % currentPts.length].x * rect.width, y: currentPts[(i + 1) % currentPts.length].y * rect.height };
                        const dSq = distSqToSegment(ptPx, p1, p2);
                        if (dSq < minD) {
                           minD = dSq;
                           insertIndex = i + 1;
                        }
                      }

                      const newPoints = [...currentPts];
                      
                      // 20 pixels threshold -> 400 squared
                      if (minD <= 400 && currentPts.length >= 2) {
                         newPoints.splice(insertIndex, 0, { x, y });
                      } else {
                         newPoints.push({ x, y });
                      }

                      updateVjSetting('customMask', { ...vjSettings.current.customMask, points: newPoints });
                    }}
                  >
                    {/* Draggable Anchors */}
                    {vjState.customMask.points.map((pt, i) => (
                      <div
                        key={`mask-pt${i}`}
                        className="absolute w-6 h-6 rounded-full border-2 border-orange-500 bg-orange-500/50 cursor-move z-50 pointer-events-auto transition-transform"
                        style={{
                          left: `${pt.x * 100}%`,
                          top: `${pt.y * 100}%`,
                          transform: `translate(-50%, -50%) scale(${1 / workspaceZoom})`,
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          isDraggingRef.current = false;
                          const onMouseMove = (moveEvent: MouseEvent) => {
                            isDraggingRef.current = true;
                            if (!workspaceRef.current) return;
                            const rect = workspaceRef.current.getBoundingClientRect();
                            const x = (moveEvent.clientX - rect.left) / rect.width;
                            const y = (moveEvent.clientY - rect.top) / rect.height;
                            
                            const newPoints = [...vjSettings.current.customMask.points];
                            newPoints[i] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
                            updateVjSetting('customMask', { ...vjSettings.current.customMask, points: newPoints });
                          };
                          
                          const onMouseUp = () => {
                            window.removeEventListener('mousemove', onMouseMove);
                            window.removeEventListener('mouseup', onMouseUp);
                            setTimeout(() => {
                               isDraggingRef.current = false;
                            }, 50);
                          };
                          
                          window.addEventListener('mousemove', onMouseMove);
                          window.addEventListener('mouseup', onMouseUp);
                        }}
                      />
                    ))}
                  </div>
                )}
            </div>
          </div>

          {/* Right Sidebar: Queue */}
          <div className="w-[clamp(16rem,20vw,24rem)] panel-frame border-l-2 border-[#27272a] flex flex-col pointer-events-auto font-mono" style={{ gridArea: 'right', minHeight: 0 }}>
            <div className="p-3 border-b border-[#27272a] flex justify-between items-center panel-recess">
              <h3 className="font-bold text-orange-500 tracking-widest text-fluid-sm flex items-center gap-2 uppercase">
                <Music size={14} /> Master Queue
              </h3>
              <span className="text-fluid-sm panel-frame text-zinc-300 px-1.5 py-0.5">{queue.length} Tracks</span>
            </div>
            <div 
              className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 custom-scrollbar"
              onDragOver={e => e.preventDefault()} 
              onDrop={onQueueDrop}
            >
              {queue.length === 0 ? (
                <div className="text-center text-zinc-500 text-fluid-sm uppercase tracking-widest mt-10 p-6 border-2 border-dashed border-[#27272a] panel-recess">
                  <span className="block mb-2">++ EMPTY QUEUE ++</span>
                  Drop Audio Files Here
                </div>
              ) : (
                queue.map((item, idx) => (
                  <div key={item.id} className="panel-recess border border-[#27272a] hover:border-orange-500 transition-colors p-2 flex flex-col gap-2 relative group">
                    <div className="absolute -top-2 -left-2 btn-inactive text-orange-500 text-fluid-xs w-4 h-4 flex items-center justify-center font-bold">
                       {idx + 1}
                    </div>
                    <div className="flex justify-between items-start pl-3">
                      <div className="text-fluid-sm text-zinc-300 truncate pr-2 font-medium uppercase" title={item.name}>{item.name}</div>
                      <div className="flex gap-1 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => {
                          if (idx > 0) {
                            const newQ = [...queue];
                            [newQ[idx-1], newQ[idx]] = [newQ[idx], newQ[idx-1]];
                            setQueue(newQ);
                          }
                        }} className="w-5 h-5 bg-zinc-900 border border-zinc-800 hover:border-zinc-500 hover:text-white flex items-center justify-center"><ArrowUp size={10}/></button>
                        <button onClick={() => {
                          if (idx < queue.length - 1) {
                            const newQ = [...queue];
                            [newQ[idx+1], newQ[idx]] = [newQ[idx], newQ[idx+1]];
                            setQueue(newQ);
                          }
                        }} className="w-5 h-5 bg-zinc-900 border border-zinc-800 hover:border-zinc-500 hover:text-white flex items-center justify-center"><ArrowDown size={10}/></button>
                        <button onClick={() => setQueue(q => q.filter(x => x.id !== item.id))} className="w-5 h-5 bg-red-950 border border-red-900 hover:bg-red-600 hover:text-white text-red-500 flex items-center justify-center ml-1"><X size={10}/></button>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={async () => {
                        engine.deckA.audio.src = URL.createObjectURL(item.file);
                        engine.deckA.audio.load();
                        await engine.deckA.extractPeaks(item.file, engine.ctx);
                        window.dispatchEvent(new CustomEvent('load-deck-a', { detail: item.name }));
                      }} className="flex-1 py-1 bg-zinc-900 border border-zinc-700 hover:border-orange-500 hover:bg-orange-600 hover:text-black text-zinc-300 text-fluid-sm font-bold transition-all tracking-widest uppercase">CUE DECK A</button>
                      <button onClick={async () => {
                        engine.deckB.audio.src = URL.createObjectURL(item.file);
                        engine.deckB.audio.load();
                        await engine.deckB.extractPeaks(item.file, engine.ctx);
                        window.dispatchEvent(new CustomEvent('load-deck-b', { detail: item.name }));
                      }} className="flex-1 py-1 bg-zinc-900 border border-zinc-700 hover:border-orange-500 hover:bg-orange-600 hover:text-black text-zinc-300 text-fluid-sm font-bold transition-all tracking-widest uppercase">CUE DECK B</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {/* Master Mix Preview inside the right panel below the queue */}
            <div className="p-2 border-t border-[#27272a] panel-recess">
              <h3 className="font-bold text-orange-500 tracking-widest text-[10px] mb-1 flex items-center gap-1 uppercase">
                <MonitorPlay size={10} /> Master Preview
              </h3>
              <div className="w-full aspect-video border border-zinc-700 bg-black relative overflow-hidden rounded-[2px] panel-frame group">
                 <canvas ref={queuePreviewCanvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                 <div className="absolute inset-0 ring-1 ring-inset ring-orange-500/20 pointer-events-none group-hover:ring-orange-500/60 transition-colors"></div>
              </div>
            </div>
          </div>

        {/* Bottom Bar: Tabbed Master Timeline & DJ Mixer Layout */}
        <div className="flex flex-col w-full h-full pointer-events-auto" style={{ gridArea: 'bottom', minHeight: 0 }}>
          {/* Dual Toggle Tab Button Strip */}
          <div className="flex bg-[#141418] border-t border-b border-[#27272a]/70 font-mono select-none px-4 py-1.5 shrink-0 justify-between items-center z-10">
            <div className="flex gap-2">
              <button 
                onClick={() => setBottomPanelTab('timeline')}
                className={`px-3 py-1 text-fluid-xs font-bold tracking-widest uppercase transition-all flex items-center gap-1.5 border rounded-[2px] ${
                  bottomPanelTab === 'timeline' 
                    ? 'bg-orange-500 text-black border-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.4)] font-extrabold' 
                    : 'bg-zinc-950/80 text-zinc-500 hover:text-zinc-300 border-zinc-800'
                }`}
              >
                <Cpu size={11} className={bottomPanelTab === 'timeline' ? 'animate-pulse' : ''} />
                1. MASTER TIMELINE
              </button>
              <button 
                onClick={() => setBottomPanelTab('djmix')}
                className={`px-3 py-1 text-fluid-xs font-bold tracking-widest uppercase transition-all flex items-center gap-1.5 border rounded-[2px] ${
                  bottomPanelTab === 'djmix' 
                    ? 'bg-orange-500 text-black border-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.4)] font-extrabold' 
                    : 'bg-zinc-950/80 text-zinc-500 hover:text-zinc-300 border-zinc-800'
                }`}
              >
                <Disc size={11} className={!engine.deckA.audio.paused || !engine.deckB.audio.paused ? 'animate-spin' : ''} />
                2. DJ MIXER & DECKS
              </button>
            </div>
            
            <div className="text-[10px] text-zinc-500 tracking-widest font-bold uppercase hidden md:block">
              {bottomPanelTab === 'timeline' ? '★ AUTOMATION GRAPH RUNNING' : '🎧 MANUAL CLUB MODE ACTIVE'}
            </div>
          </div>

          <div className="flex-1 min-h-0 relative">
            {bottomPanelTab === 'timeline' ? (
              <MasterTimeline 
                timeline={timeline}
                setTimeline={setTimeline}
                timelineRef={timelineRef}
                vjState={vjState}
                updateVjSetting={updateVjSetting}
                engine={engine}
                queue={queue}
              />
            ) : (
              <div className="panel-frame flex h-full pointer-events-auto font-mono">
                <div className="flex-1 px-4 py-2 border-r border-[#27272a] flex flex-col justify-center">
                  <DeckUI deck={engine.deckA} id="a" engine={engine} queue={queue} />
                </div>
                
                <div className="w-[clamp(16rem,20vw,24rem)] px-6 py-2 flex flex-col justify-center gap-4 bg-zinc-900/10">
                  <div className="flex justify-between items-center panel-recess px-3 py-1.5 border-b border-b-orange-500">
                    <h3 className="font-bold text-orange-500 tracking-widest text-fluid-sm flex items-center gap-2 uppercase">
                      <Sliders size={12} /> Master Mix
                    </h3>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-fluid-sm uppercase font-bold tracking-widest px-1">
                      <span className="text-orange-500">DECK A</span>
                      <span className="text-zinc-600">Crossfade</span>
                      <span className="text-orange-500">DECK B</span>
                    </div>
                    <input type="range" min="0" max="100" value={crossfader} onChange={e => {
                      setCrossfader(parseFloat(e.target.value));
                      engine.updateMixer(parseFloat(e.target.value), masterVol);
                    }} className="w-full neo-slider" />
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <span className="text-fluid-sm font-bold text-zinc-500 tracking-widest uppercase">Vol</span>
                    <input type="range" min="0" max="100" value={masterVol} onChange={e => {
                      setMasterVol(parseFloat(e.target.value));
                      engine.updateMixer(crossfader, parseFloat(e.target.value));
                    }} className="flex-1 neo-slider" />
                    <span className="text-fluid-sm text-orange-500 panel-recess px-2 py-0.5 min-w-[3rem] text-center">{masterVol}</span>
                  </div>
                </div>

                <div className="flex-1 px-4 py-2 border-l border-[#27272a] flex flex-col justify-center">
                  <DeckUI deck={engine.deckB} id="b" engine={engine} queue={queue} />
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {showLegend && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 font-mono pointer-events-auto" onClick={() => setShowLegend(false)}>
          <div className="bg-zinc-950 border border-zinc-800 max-w-lg w-full shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-orange-500 font-bold uppercase tracking-widest text-fluid-xl">System Uplink Commands</h2>
              <button onClick={() => setShowLegend(false)} className="text-zinc-500 hover:text-white p-1">
                <X size={20} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-fluid-base text-zinc-300">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                <span>Toggle Mapping</span>
                <kbd className="bg-zinc-900 border border-zinc-700 px-2 rounded text-orange-500 font-bold">M</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                <span>Toggle Mask Pen</span>
                <kbd className="bg-zinc-900 border border-zinc-700 px-2 rounded text-orange-500 font-bold">P</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                <span>Toggle Video</span>
                <kbd className="bg-zinc-900 border border-zinc-700 px-2 rounded text-orange-500 font-bold">V</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                <span>Regenerate Chaos</span>
                <kbd className="bg-zinc-900 border border-zinc-700 px-2 rounded text-orange-500 font-bold">C</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                <span>Show Cheat Sheet</span>
                <kbd className="bg-zinc-900 border border-zinc-700 px-2 rounded text-orange-500 font-bold">?</kbd>
              </div>
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                <span>Close Popup</span>
                <kbd className="bg-zinc-900 border border-zinc-700 px-2 rounded text-orange-500 font-bold">ESC</kbd>
              </div>
            </div>
            
            <div className="mt-8 text-fluid-sm text-zinc-500 uppercase tracking-widest text-center border-t border-zinc-800 pt-4">
              Rush XR Automix Studio v1.0.0
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeckUI({ deck, id, engine, queue }: { deck: Deck, id: string, engine: AudioEngine, queue: any[] }) {
  const [trackName, setTrackName] = useState("No track loaded");
  const [timeStr, setTimeStr] = useState("00:00 / 00:00");
  const [isPlaying, setIsPlaying] = useState(false);
  const [vol, setVol] = useState(100);
  const [filter, setFilter] = useState(50);
  const [eqLow, setEqLow] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onTimeUpdate = () => {
      const formatTime = (s: number) => {
        if (isNaN(s)) return "--:--";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
      };
      setTimeStr(`${formatTime(deck.audio.currentTime)} / ${formatTime(deck.audio.duration)}`);
    };

    const onEnded = () => setIsPlaying(false);

    const onLoadEvent = (e: any) => {
      setTrackName(e.detail);
    };

    deck.audio.addEventListener('timeupdate', onTimeUpdate);
    deck.audio.addEventListener('ended', onEnded);
    window.addEventListener(`load-deck-${id}` as any, onLoadEvent);
    
    return () => {
      deck.audio.removeEventListener('timeupdate', onTimeUpdate);
      deck.audio.removeEventListener('ended', onEnded);
      window.removeEventListener(`load-deck-${id}` as any, onLoadEvent);
    };
  }, [deck, id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const render = () => {
      const width = canvas.width = canvas.clientWidth;
      const height = canvas.height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      if (deck.peaks.length > 0 && deck.audio.duration > 0) {
        const progress = deck.audio.currentTime / deck.audio.duration;
        const barWidth = width / deck.peaks.length;

        for (let i = 0; i < deck.peaks.length; i++) {
          const x = i * barWidth;
          const percent = i / deck.peaks.length;
          const peakHeight = deck.peaks[i] * height * 0.9;
          const y = (height - peakHeight) / 2;

          ctx.fillStyle = percent < progress ? "#ff5e00" : "#52525b";
          ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), peakHeight);
        }

        const playheadX = progress * width;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(playheadX - 1, 0, 2, height);
      }
      animId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animId);
  }, [deck]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      deck.audio.src = URL.createObjectURL(file);
      setTrackName(file.name);
      deck.audio.load();
      await deck.extractPeaks(file, engine.ctx);
    }
  };

  const togglePlay = () => {
    if (engine.ctx.state === 'suspended') engine.ctx.resume();
    if (deck.audio.paused) {
      deck.audio.play().catch(e => console.error("Audio play error:", e));
      setIsPlaying(true);
    } else {
      deck.audio.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div 
      onDragOver={e => e.preventDefault()} 
      onDrop={onDrop}
      className="h-full flex flex-col justify-between gap-2 font-mono"
    >
      <div className="flex justify-between items-center panel-frame border-b-2 border-orange-500 px-3 py-1">
        <h2 className="orbitron text-orange-500 font-bold text-fluid-lg tracking-widest leading-none">DECK {id.toUpperCase()}</h2>
        <div className="text-fluid-sm font-bold text-orange-500 panel-recess px-2 py-0.5">{timeStr}</div>
      </div>
      
      <div className="text-fluid-sm text-orange-500 truncate panel-recess px-4 py-2 uppercase font-bold tracking-widest relative overflow-hidden" style={{ minHeight: "2.5rem", display: "flex", alignItems: "center" }}>
        <div className="absolute top-0 left-0 w-1 h-full bg-orange-600 animate-pulse"></div>
        {trackName}
      </div>
      
      <div className="flex flex-col gap-1 relative panel-recess p-0.5 flex-1 min-h-[2rem]">
        <canvas ref={canvasRef} className="w-full h-full min-h-[1.5rem] bg-zinc-950 cursor-pointer flex-1" 
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = Math.max(0, Math.min(1, x / rect.width));
            if (deck.audio.duration) deck.audio.currentTime = percent * deck.audio.duration;
          }}
        />
      </div>
      
      <div className="flex gap-2 h-full">
        <div className="flex flex-col gap-2 w-20">
          <button onClick={togglePlay} className={`flex-1 text-fluid-sm uppercase font-bold transition-all tracking-widest flex flex-col items-center justify-center gap-1 border rounded-sm ${isPlaying ? 'led-active text-black' : 'btn-inactive hover:border-zinc-500'}`}>
            {isPlaying ? <Pause size={14}/> : <Play size={14}/>}
            {isPlaying ? 'PAUSE' : 'PLAY'}
          </button>
          <button 
            onMouseDown={() => { 
              deck.audio.currentTime = 0; 
              deck.audio.play().catch(e => console.error("Audio play error in cue:", e)); 
            }}
            onMouseUp={() => { deck.audio.pause(); deck.audio.currentTime = 0; }}
            className="flex-1 btn-inactive rounded-sm hover:border-blue-500 hover:bg-blue-600 hover:text-black text-zinc-400 text-fluid-sm uppercase font-bold transition-all tracking-widest flex flex-col items-center justify-center gap-1"
          >
            <FastForward size={14}/>
            CUE
          </button>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-2 bg-transparent p-2">
          <Slider label="GAIN" min={0} max={100} value={vol} onChange={(v: number) => { setVol(v); deck.vol = v; engine.updateMixer(50, 80); }} />
          <Slider label="FILTER" min={0} max={100} value={filter} onChange={(v: number) => { setFilter(v); deck.setFilter(v); }} />
          <Slider label="LOW" min={-40} max={15} value={eqLow} onChange={(v: number) => { setEqLow(v); deck.lowNode.gain.value = v; }} />
          <Slider label="HIGH" min={-40} max={15} value={eqHigh} onChange={(v: number) => { setEqHigh(v); deck.highNode.gain.value = v; }} />
        </div>
      </div>
    </div>
  );
}

const MappingControl = ({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) => (
  <div className="flex flex-col gap-1 w-full font-mono">
    <span className="text-fluid-sm text-zinc-500 uppercase tracking-widest">{label}</span>
    <div className="flex border border-zinc-800 pointer-events-auto panel-recess">
      {['none', 'bass', 'mid', 'high'].map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`flex-1 text-fluid-xs py-1 uppercase transition-colors ${value === opt ? 'led-active font-bold' : 'btn-inactive'}`}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
);


function VJPanel({ vjState, updateVjSetting, updateLayer, addLayer, removeLayer, cameraVideoRef, mediaVideoRef }: any) {
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(vjState.layers[0]?.id || null);
  const [activeTab, setActiveTab] = useState<'mapping'|'media'|'camera'|'visuals'|null>('visuals');

  const lastStateRef = useRef(vjState);
  useEffect(() => {
    lastStateRef.current = vjState;
  }, [vjState]);

  useEffect(() => {
    const video = mediaVideoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setVideoTime(video.currentTime);
    const handleLoadedMetadata = () => setVideoDuration(video.duration);
    const handlePlay = () => updateVjSetting('isVideoPlaying', true);
    const handlePause = () => {
      if (lastStateRef.current.videoReverseLoop && lastStateRef.current.videoDirection === 'backward') {
        return;
      }
      updateVjSetting('isVideoPlaying', false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    setVideoTime(video.currentTime);
    setVideoDuration(video.duration || 0);
    updateVjSetting('isVideoPlaying', !video.paused);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [mediaVideoRef, updateVjSetting]);

  const activeLayer = vjState.layers.find((l: any) => l.id === activeLayerId);

  return (
    <div className="flex h-full text-fluid-base text-zinc-300">
      
      {/* Tiny Vertical Tab Strip on the Left */}
      <div className="w-12 shrink-0 panel-frame border-r-2 border-[#27272a] flex flex-col items-center py-3 gap-3 z-10 font-mono">
        <button 
          onClick={() => setActiveTab(activeTab === 'mapping' ? null : 'mapping')}
          className={`flex flex-col items-center justify-center w-8 h-8 rounded-sm transition-colors ${activeTab === 'mapping' ? 'bg-orange-600 shadow-[0_0_10px_rgba(255,94,0,0.5)] text-white' : 'text-zinc-500 hover:text-white btn-inactive'}`}
          title="Mapping Layers"
        >
          <Maximize size={16} />
        </button>
        <button 
          onClick={() => setActiveTab(activeTab === 'media' ? null : 'media')}
          className={`flex flex-col items-center justify-center w-8 h-8 rounded-sm transition-colors ${activeTab === 'media' ? 'bg-orange-600 shadow-[0_0_10px_rgba(255,94,0,0.5)] text-white' : 'text-zinc-500 hover:text-white btn-inactive'}`}
          title="Media Player"
        >
          <Monitor size={16} />
        </button>
        <button 
          onClick={() => setActiveTab(activeTab === 'camera' ? null : 'camera')}
          className={`flex flex-col items-center justify-center w-8 h-8 rounded-sm transition-colors ${activeTab === 'camera' ? 'bg-orange-600 shadow-[0_0_10px_rgba(255,94,0,0.5)] text-white' : 'text-zinc-500 hover:text-white btn-inactive'}`}
          title="Camera Seg"
        >
          <Camera size={16} />
        </button>
        <button 
          onClick={() => setActiveTab(activeTab === 'visuals' ? null : 'visuals')}
          className={`flex flex-col items-center justify-center w-8 h-8 rounded-sm transition-colors ${activeTab === 'visuals' ? 'bg-orange-600 shadow-[0_0_10px_rgba(255,94,0,0.5)] text-white' : 'text-zinc-500 hover:text-white btn-inactive'}`}
          title="Visual Parameters"
        >
          <Settings size={16} />
        </button>
      </div>

      <AnimatePresence mode="sync">
        {activeTab && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "var(--w-panel)", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="h-full overflow-hidden shrink-0 border-r-2 border-[#27272a] bg-zinc-900/10 flex flex-col pointer-events-auto font-mono backdrop-blur-md relative"
          >
            <div className="absolute inset-0 pointer-events-none panel-frame z-[-1]"></div>
            <div className="w-[var(--w-panel)] h-full flex flex-col min-w-[var(--w-panel)] relative z-10">
              <div className="p-4 border-b border-[#27272a] panel-recess">
                <h3 className="font-bold text-orange-500 tracking-widest text-fluid-sm flex items-center gap-2 uppercase">
                   {activeTab === 'mapping' && <><Maximize size={14} /> Mapping Layers</>}
                   {activeTab === 'media' && <><Monitor size={14} /> Media Player</>}
                   {activeTab === 'camera' && <><Camera size={14} /> Camera Segmentation</>}
                   {activeTab === 'visuals' && <><Settings size={14} /> Visual Parameters</>}
                </h3>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
                
                {activeTab === 'mapping' && (
                  <>
                    <div className="flex justify-between items-center">
                      <div className="flex gap-1 ml-auto">
                        <button onClick={() => addLayer('visualizer')} className="p-1 bg-zinc-800 hover:bg-orange-600 rounded text-fluid-sm font-bold">VIS</button>
                        <button onClick={() => addLayer('video')} className="p-1 bg-zinc-800 hover:bg-orange-600 rounded text-fluid-sm font-bold">VID</button>
                        <button onClick={() => addLayer('camera')} className="p-1 bg-zinc-800 hover:bg-orange-600 rounded text-fluid-sm font-bold">CAM</button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 min-h-[140px] max-h-[35vh] overflow-y-auto panel-recess p-2 border border-[#27272a] custom-scrollbar">
                      {vjState.layers.map((layer: any) => (
                        <div 
                          key={layer.id} 
                          onClick={() => setActiveLayerId(layer.id)}
                          className={`flex items-center gap-2 p-2 shrink-0 min-h-[42px] cursor-pointer transition-all border ${activeLayerId === layer.id ? 'led-active' : 'btn-inactive hover:border-zinc-500'}`}
                        >
                          <input 
                            type="checkbox" 
                            checked={layer.active} 
                            onChange={(e) => updateLayer(layer.id, { active: e.target.checked })}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-orange-500"
                          />
                          <span className="flex-1 text-fluid-sm font-bold truncate uppercase tracking-tighter">{layer.name}</span>
                          <span className="text-fluid-xs text-zinc-500 px-1 panel-frame rounded uppercase">{layer.type}</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); if(activeLayerId === layer.id) setActiveLayerId(null); }}
                            className="p-1 hover:text-red-500"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 p-4 border border-orange-500/15" style={{ padding: "1rem" }}>
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-fluid-sm font-bold text-orange-500 uppercase tracking-widest flex items-center gap-2">
                           Surface Mapping
                        </h4>
                        <button onClick={() => updateVjSetting('isMappingActive', !vjState.isMappingActive)} className={`text-fluid-xs px-2 py-0.5 border ${vjState.isMappingActive ? 'led-active text-black font-bold' : 'btn-inactive text-zinc-400'}`}>
                          {vjState.isMappingActive ? 'MAPPING ON' : 'MAPPING OFF'}
                        </button>
                      </div>
                      {vjState.isMappingActive && (
                         <div className="flex flex-col gap-2">
                            <button onClick={() => window.dispatchEvent(new CustomEvent('add-map-surface'))} className="w-full py-1 text-fluid-xs font-bold btn-inactive hover:bg-orange-600 hover:text-black hover:border-orange-500 uppercase transition-colors">
                                + Add Surface
                            </button>
                            {vjState.mapSurfaces.map((surf: MapSurface) => (
                                <div key={surf.id} onClick={() => updateVjSetting('activeMapSurfaceId', surf.id)} className={`flex justify-between items-center p-1.5 cursor-pointer border ${vjState.activeMapSurfaceId === surf.id ? 'led-active text-black' : 'btn-inactive text-zinc-400'}`}>
                                    <span className="text-fluid-sm font-bold uppercase">{surf.name}</span>
                                    <button onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('remove-map-surface', { detail: surf.id })); }} className="hover:text-red-500">
                                       <X size={10} />
                                    </button>
                                </div>
                            ))}
                         </div>
                      )}
                    </div>

                    {activeLayer && (
                      <div className="flex flex-col gap-3 p-4 border border-orange-500/15 mt-2" style={{ padding: "1rem" }}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-fluid-sm font-bold text-orange-500 uppercase tracking-widest">{activeLayer.name} Settings</span>
                        </div>
                        
                        <Slider label="Opacity" min={0} max={1} step={0.01} value={activeLayer.opacity} onChange={(v: number) => updateLayer(activeLayer.id, { opacity: v })} />
                        <Slider label="Scale" min={0.1} max={3} step={0.01} value={activeLayer.scale} onChange={(v: number) => updateLayer(activeLayer.id, { scale: v })} />
                        <Slider label="Rotation" min={-180} max={180} value={activeLayer.rotation} onChange={(v: number) => updateLayer(activeLayer.id, { rotation: v })} />
                        <Slider label="Perspective" min={100} max={2000} value={activeLayer.perspective} onChange={(v: number) => updateLayer(activeLayer.id, { perspective: v })} />
                        
                        <div className="mt-4 p-4 border border-orange-500/15" style={{ padding: "1rem" }}>
                          <h4 className="text-fluid-sm font-bold uppercase tracking-widest text-orange-500 mb-3">Audio Mapping</h4>
                          <div className="grid grid-cols-1 gap-3">
                            <MappingControl label="Scale Map" value={activeLayer.mapping?.scale || 'none'} onChange={(v: any) => updateLayer(activeLayer.id, { mapping: { ...(activeLayer.mapping || {}), scale: v } })} />
                            <MappingControl label="Rotation Map" value={activeLayer.mapping?.rotation || 'none'} onChange={(v: any) => updateLayer(activeLayer.id, { mapping: { ...(activeLayer.mapping || {}), rotation: v } })} />
                            <MappingControl label="Opacity Map" value={activeLayer.mapping?.opacity || 'none'} onChange={(v: any) => updateLayer(activeLayer.id, { mapping: { ...(activeLayer.mapping || {}), opacity: v } })} />
                            <MappingControl label="Displace Map" value={activeLayer.mapping?.displacement || 'none'} onChange={(v: any) => updateLayer(activeLayer.id, { mapping: { ...(activeLayer.mapping || {}), displacement: v } })} />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
                          <Slider label="Skew X" min={-45} max={45} value={activeLayer.skewX} onChange={(v: number) => updateLayer(activeLayer.id, { skewX: v })} />
                          <Slider label="Skew Y" min={-45} max={45} value={activeLayer.skewY} onChange={(v: number) => updateLayer(activeLayer.id, { skewY: v })} />
                          <Slider label="Off X" min={-1000} max={1000} value={activeLayer.offsetX} onChange={(v: number) => updateLayer(activeLayer.id, { offsetX: v })} />
                          <Slider label="Off Y" min={-1000} max={1000} value={activeLayer.offsetY} onChange={(v: number) => updateLayer(activeLayer.id, { offsetY: v })} />
                        </div>

                        {activeLayer.type === 'visualizer' && (
                          <div className="mt-2 text-fluid-sm">
                            <label className="text-zinc-500 uppercase tracking-widest mb-1 block">Visualizer Mode</label>
                            <select 
                              value={activeLayer.visualizerMode} 
                              onChange={(e) => updateLayer(activeLayer.id, { visualizerMode: parseInt(e.target.value) })}
                              className="w-full panel-recess border border-[#27272a] p-2 text-zinc-300 outline-none focus:border-orange-500 font-mono focus:bg-zinc-900 uppercase"
                            >
                              <option value={0}>Waveform</option>
                              <option value={1}>3D Terrain</option>
                              <option value={2}>Particles</option>
                              <option value={3}>Cylinder</option>
                              <option value={4}>Matrix</option>
                              <option value={5}>DNA Helix</option>
                              <option value={6}>Chaos Art</option>
                              <option value={7}>3D Shader</option>
                            </select>
                          </div>
                        )}

                        {activeLayer.type === 'video' && (
                          <div className="mt-2">
                            <label className="text-fluid-sm text-zinc-500 uppercase tracking-widest mb-1 block">Video Source</label>
                            <input 
                              type="file" 
                              accept="video/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const url = URL.createObjectURL(file);
                                  updateLayer(activeLayer.id, { videoSrc: url });
                                }
                              }}
                              className="text-fluid-xs w-full text-zinc-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:font-bold file:bg-zinc-800 file:text-orange-500 hover:file:bg-zinc-700"
                            />
                          </div>
                        )}

                        <div className="mt-2">
                          <label className="text-fluid-sm text-zinc-500 uppercase tracking-widest mb-1 block">Blend Mode</label>
                          <select 
                            value={activeLayer.blendMode} 
                            onChange={(e) => updateLayer(activeLayer.id, { blendMode: e.target.value })}
                            className="w-full panel-recess border border-[#27272a] text-fluid-sm p-2 text-zinc-300 outline-none focus:border-orange-500 font-mono focus:bg-zinc-900 uppercase"
                          >
                            <option value="source-over">Normal</option>
                            <option value="screen">Screen</option>
                            <option value="additive">Additive</option>
                            <option value="multiply">Multiply</option>
                            <option value="overlay">Overlay</option>
                            <option value="difference">Difference</option>
                            <option value="exclusion">Exclusion</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {activeTab === 'media' && (
                  <div className="flex flex-col gap-3 panel-frame p-4 border border-[#27272a] shadow-lg">
                    <input 
                      type="file" 
                      accept="video/mp4,video/webm" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          updateVjSetting('videoSrc', url);
                          updateVjSetting('isVideoActive', true);
                          updateVjSetting('isVideoPlaying', true);
                        }
                      }}
                      className="text-fluid-sm text-zinc-400 file:mr-4 file:py-1.5 file:px-3 file:border-0 file:font-bold file:bg-zinc-800 file:text-orange-500 hover:file:bg-zinc-700 w-full"
                    />
                    {vjState.videoSrc && (
                      <>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => {
                            const newState = !vjState.isVideoActive;
                            updateVjSetting('isVideoActive', newState);
                          }} className={`flex-1 py-1.5 text-fluid-sm font-bold border transition-colors tracking-widest uppercase ${vjState.isVideoActive ? 'led-active' : 'btn-inactive text-zinc-500'}`}>
                            {vjState.isVideoActive ? 'HIDE VIDEO' : 'SHOW VIDEO'}
                          </button>
                          <button onClick={() => {
                            if (mediaVideoRef.current) {
                              if (vjState.isVideoPlaying) {
                                mediaVideoRef.current.pause();
                                updateVjSetting('isVideoPlaying', false);
                              } else {
                                updateVjSetting('isVideoPlaying', true);
                                mediaVideoRef.current.play().catch(err => {
                                  if (err.name !== 'AbortError') {
                                    console.error("Play error:", err);
                                  }
                                });
                              }
                            }
                          }} className={`flex-1 py-1.5 text-fluid-sm font-bold border transition-colors tracking-widest uppercase ${vjState.isVideoPlaying ? 'border-green-500 bg-green-500/20 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.3)]' : 'btn-inactive text-zinc-500'}`}>
                            {vjState.isVideoPlaying ? 'PAUSE' : 'PLAY'}
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-3 mt-2 panel-recess border border-[#27272a] px-3 py-2">
                          <span className="text-fluid-sm text-orange-500 w-8 text-right font-mono font-bold">
                            {Math.floor((videoTime || 0) / 60)}:{(Math.floor((videoTime || 0) % 60)).toString().padStart(2, '0')}
                          </span>
                          <input 
                            type="range" 
                            min={0} 
                            max={videoDuration || 100} 
                            step={0.1} 
                            value={videoTime || 0} 
                            onChange={(e) => {
                              const newTime = parseFloat(e.target.value);
                              setVideoTime(newTime);
                              if (mediaVideoRef.current) {
                                mediaVideoRef.current.currentTime = newTime;
                              }
                            }} 
                            className="flex-1 neo-slider" 
                          />
                          <span className="text-fluid-sm text-zinc-500 w-8 font-mono">
                            {Math.floor((videoDuration || 0) / 60)}:{(Math.floor((videoDuration || 0) % 60)).toString().padStart(2, '0')}
                          </span>
                        </div>

                        <div className="mt-4 flex flex-col gap-3">
                          <Slider label="Opacity" min={0} max={1} step={0.05} value={vjState.videoOpacity} onChange={(v: number) => updateVjSetting('videoOpacity', v)} />
                          
                          <div className="mt-1">
                            <label className="text-fluid-xs text-zinc-500 uppercase tracking-widest mb-1 block">Loop Mode</label>
                            <button
                              onClick={() => {
                                const newVal = !vjState.videoReverseLoop;
                                updateVjSetting('videoReverseLoop', newVal);
                                if (newVal) {
                                  updateVjSetting('videoDirection', vjState.videoDirection || 'forward');
                                  if (mediaVideoRef.current) {
                                    mediaVideoRef.current.loop = false;
                                  }
                                } else {
                                  if (mediaVideoRef.current) {
                                    mediaVideoRef.current.loop = true;
                                  }
                                }
                              }}
                              className={`w-full py-1.5 text-fluid-sm font-bold border transition-all duration-300 tracking-wider uppercase rounded-sm ${vjState.videoReverseLoop ? 'border-orange-500 bg-orange-500/15 text-orange-400 font-bold shadow-[0_0_12px_rgba(255,94,0,0.25)]' : 'btn-inactive text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {vjState.videoReverseLoop ? 'YOYO LOOPING (PING-PONG)' : 'STANDARD LOOP'}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === 'camera' && (
                  <>
                    <button 
                      onClick={async () => {
                        if (vjState.isCameraActive) {
                          const stream = cameraVideoRef.current?.srcObject as MediaStream;
                          stream?.getTracks().forEach(t => t.stop());
                          updateVjSetting('isCameraActive', false);
                        } else {
                          try {
                            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                            if (cameraVideoRef.current) {
                              cameraVideoRef.current.srcObject = stream;
                              cameraVideoRef.current.play().catch(e => console.error("Camera play error:", e));
                            }
                            updateVjSetting('isCameraActive', true);

                            if (!(window as any).faceLandmarker && !(window as any).isLandmarkersInitializing) {
                              (window as any).isLandmarkersInitializing = true;
                              const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
                              (window as any).faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                                baseOptions: {
                                  modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                                  delegate: "GPU"
                                },
                                outputFaceBlendshapes: false,
                                runningMode: "VIDEO",
                                numFaces: 1
                              });
                              (window as any).handLandmarker = await HandLandmarker.createFromOptions(vision, {
                                baseOptions: {
                                  modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                                  delegate: "GPU"
                                },
                                runningMode: "VIDEO",
                                numHands: 2
                              });
                              (window as any).isLandmarkersInitializing = false;
                            }
                          } catch (e) {
                            console.error(e);
                          }
                        }
                      }}
                      className={`py-2.5 px-4 text-fluid-sm font-bold rounded tracking-widest flex items-center justify-center gap-2 transition-colors border ${vjState.isCameraActive ? 'border-green-500 bg-green-500/20 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.3)]' : 'btn-inactive text-zinc-300'}`}
                    >
                      <Camera size={14} />
                      {vjState.isCameraActive ? 'DEACTIVATE CAMERA' : 'ACTIVATE CAMERA SEG'}
                    </button>
                    {vjState.isCameraActive && (
                      <>
                        <CameraUIPreview cameraVideoRef={cameraVideoRef} />
                        <div className="flex flex-col gap-3 panel-frame p-4 border border-[#27272a] mt-2 shadow-lg">
                          <div className="text-fluid-sm text-zinc-500 font-mono text-center">
                             Using MediaPipe Face & Hand Landmarker to project 3D wireframes onto surfaces.
                          </div>
                          {/* Removing older filter options as we use Mediapipe now */}
                        </div>
                      </>
                    )}
                  </>
                )}

                {activeTab === 'visuals' && (
                  <div className="flex flex-col gap-3 panel-frame p-4 border border-[#27272a] shadow-lg">
                    <div className="mb-3">
                      <label className="block text-fluid-sm text-zinc-500 mb-2 font-mono tracking-widest uppercase">Global Mode</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                          <button
                            key={i}
                            onClick={() => {
                              updateVjSetting('activeVisualizer', i);
                              const targetId = activeLayerId || vjState.layers.find((l: any) => l.type === 'visualizer')?.id;
                              if (targetId) {
                                updateLayer(targetId, { visualizerMode: i });
                              }
                            }}
                            className={`py-2 border rounded-sm text-fluid-sm font-bold transition-colors shadow-sm ${vjState.activeVisualizer === i ? 'led-active' : 'btn-inactive hover:border-orange-500/50'}`}
                          >
                            V{i+1}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 mb-1 panel-recess border border-[#27272a] p-3">
                      <label className="flex items-center gap-3 cursor-pointer text-fluid-sm font-mono uppercase tracking-widest text-zinc-400">
                        <input type="checkbox" checked={vjState.autoHue} onChange={e => updateVjSetting('autoHue', e.target.checked)} className="accent-orange-500 w-4 h-4" />
                        Auto-Hue
                      </label>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-fluid-sm font-mono uppercase tracking-widest text-zinc-400 w-16">Color</span>
                        <input type="color" value={vjState.color} onChange={e => updateVjSetting('color', e.target.value)} className="flex-1 h-8 cursor-pointer rounded border-0 bg-transparent" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 mt-4">
                      <Slider label="Scale" min={0.1} max={5} step={0.1} value={vjState.scale} onChange={(v: number) => updateVjSetting('scale', v)} />
                      <Slider label="Core Rot" min={0} max={0.05} step={0.001} value={vjState.rotationSpeed} onChange={(v: number) => updateVjSetting('rotationSpeed', v)} />
                      <Slider label="Ring Rot" min={-0.05} max={0.05} step={0.001} value={vjState.ringSpeed} onChange={(v: number) => updateVjSetting('ringSpeed', v)} />
                      <Slider label="Ring Dens" min={0} max={800} step={10} value={vjState.ringDensity} onChange={(v: number) => updateVjSetting('ringDensity', v)} />
                    </div>

                    <div className="flex flex-col gap-3 mt-4 border-t border-[#27272a] pt-4">
                      <Slider label="Kick Gate" min={100} max={255} value={vjState.threshold} onChange={(v: number) => updateVjSetting('threshold', v)} />
                      <Slider label="Bass Disp" min={0} max={5} step={0.1} value={vjState.displacement} onChange={(v: number) => updateVjSetting('displacement', v)} />
                    </div>
                    
                    <div className="mt-4 border-t border-[#27272a] pt-4">
                      <h5 className="text-fluid-sm uppercase font-bold text-orange-500 mb-3 tracking-widest">Chaos Art Settings</h5>
                      <div className="flex gap-2 mb-4">
                         {['VIBRANT', 'NEON', 'PASTEL', 'MOODY'].map(mood => (
                            <button 
                              key={mood} 
                              onClick={() => updateVjSetting('paletteMood', mood)} 
                              className={`flex-1 py-1.5 text-fluid-xs font-bold rounded ${vjState.paletteMood === mood ? 'bg-orange-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                            >
                              {mood}
                            </button>
                         ))}
                      </div>
                      <div className="flex flex-col gap-3">
                        <Slider label="Chaos" min={0} max={1} step={0.1} value={vjState.chaosLevel} onChange={(v: number) => updateVjSetting('chaosLevel', v)} />
                        <Slider label="Splat" min={0} max={1} step={0.1} value={vjState.splatFrequency} onChange={(v: number) => updateVjSetting('splatFrequency', v)} />
                        <Slider label="Density" min={20} max={150} step={10} value={vjState.chaosDensity} onChange={(v: number) => updateVjSetting('chaosDensity', v)} />
                      </div>
                      <button onClick={() => window.dispatchEvent(new CustomEvent('regenerate-chaos'))} className="w-full mt-4 py-2 bg-zinc-800 hover:bg-orange-600 border border-zinc-700 text-fluid-sm font-bold rounded text-white tracking-widest transition-colors">
                        REGENERATE CHAOS
                      </button>
                    </div>
                  </div>
                )}
                
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Slider({ label, min, max, step = 1, value, onChange }: any) {
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center pr-1">
        <span className="text-fluid-sm text-zinc-400 uppercase tracking-widest font-mono">{label}</span>
        <span className="text-fluid-sm text-orange-500 font-mono panel-recess px-2 py-0.5">{safeValue.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={safeValue} onChange={e => onChange(parseFloat(e.target.value))} className="w-full neo-slider" />
    </div>
  );
}
