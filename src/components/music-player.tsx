import { useState, useRef, useEffect } from "react";
import { Music, Play, Pause, Volume2, VolumeX, Headphones, CloudRain, Waves, Coffee, Disc } from "lucide-react";

interface Station {
  id: string;
  name: string;
  icon: React.ElementType;
  type: "youtube" | "local" | "webaudio";
  youtubeId?: string;
  audioSrc?: string;
  webAudioType?: "rain" | "ocean" | "coffee" | "classical";
}

const stations: Station[] = [
  { id: "lofi", name: "Lofi Hip Hop", icon: Headphones, type: "local", audioSrc: "/audio/lofi.mp3" },
  { id: "rain", name: "Rain", icon: CloudRain, type: "webaudio", webAudioType: "rain" },
  { id: "ocean", name: "Ocean", icon: Waves, type: "webaudio", webAudioType: "ocean" },
  { id: "coffee", name: "Coffee Shop", icon: Coffee, type: "webaudio", webAudioType: "coffee" },
  { id: "classical", name: "Classical", icon: Disc, type: "webaudio", webAudioType: "classical" },
];

export function MusicPlayer() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(50);
  const [selectedStation, setSelectedStation] = useState<Station>(stations[0]);
  const playerRef = useRef<HTMLIFrameElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<AudioNode[]>([]);

  const createWhiteNoise = (ctx: AudioContext) => {
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    return noise;
  };

  const createPinkNoise = (ctx: AudioContext) => {
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11;
      b6 = white * 0.115926;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    return noise;
  };

  const setupWebAudio = (type: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume / 100;
    gainNodeRef.current = gainNode;
    sourcesRef.current = [];

    if (type === "rain") {
      const noise = createWhiteNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);
      noise.start();
      sourcesRef.current.push(noise);
    } else if (type === "ocean") {
      const noise = createWhiteNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.1;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.3;
      lfo.connect(lfoGain);
      lfoGain.connect(gainNode.gain);
      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);
      noise.start();
      lfo.start();
      sourcesRef.current.push(noise, lfo);
    } else if (type === "coffee") {
      const noise = createPinkNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 800;
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.15;
      noise.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(gainNode);
      gainNode.connect(ctx.destination);
      noise.start();
      sourcesRef.current.push(noise);
    } else if (type === "classical") {
      const frequencies = [220, 261.63, 329.63];
      frequencies.forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.05;
        osc.connect(oscGain);
        oscGain.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start();
        sourcesRef.current.push(osc);
      });
    }
  };

  const stopWebAudio = () => {
    sourcesRef.current.forEach((source) => {
      if (source instanceof OscillatorNode) {
        source.stop();
      } else if (source instanceof AudioBufferSourceNode) {
        source.stop();
      }
    });
    sourcesRef.current = [];
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  };

  const toggleMute = () => {
    setVolume(volume === 0 ? 50 : 0);
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, [volume]);

  useEffect(() => {
    if (selectedStation.type === "local" && audioRef.current) {
      if (isPlaying) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    } else if (selectedStation.type === "webaudio") {
      if (isPlaying) {
        setupWebAudio(selectedStation.webAudioType!);
      } else {
        stopWebAudio();
      }
    }
  }, [isPlaying, selectedStation]);

  useEffect(() => {
    return () => {
      stopWebAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Collapsed State */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="h-12 w-12 rounded-full bg-black text-white flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
        >
          <Music className="h-5 w-5" />
        </button>
      )}

      {/* Expanded State */}
      {isExpanded && (
        <div className="bg-background border border-border/60 rounded-2xl shadow-2xl w-72 overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-border/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Study Music</span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors"
            >
              ×
            </button>
          </div>

          {/* Station Selection */}
          <div className="p-3">
            <div className="grid grid-cols-5 gap-2">
              {stations.map((station) => {
                const Icon = station.icon;
                return (
                  <button
                    key={station.id}
                    onClick={() => {
                      setSelectedStation(station);
                      setIsPlaying(false);
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
                      selectedStation.id === station.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-card/60 text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[10px] leading-tight">{station.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Station Info */}
          <div className="px-4 py-2 border-t border-border/60">
            <div className="flex items-center gap-2">
              {(() => {
                const Icon = selectedStation.icon;
                return <Icon className="h-4 w-4 text-primary" />;
              })()}
              <span className="text-sm font-medium text-foreground">{selectedStation.name}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="p-4 border-t border-border/60 flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="h-10 w-10 rounded-full bg-black text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>

            <div className="flex-1 flex items-center gap-2">
              <button onClick={toggleMute} className="text-muted-foreground hover:text-foreground transition-colors">
                {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={handleVolumeChange}
                className="flex-1 h-1 bg-border rounded-full appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Hidden Audio Player for Local Files */}
          {selectedStation.type === "local" && (
            <audio
              ref={audioRef}
              src={selectedStation.audioSrc}
              loop
              onEnded={() => setIsPlaying(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
