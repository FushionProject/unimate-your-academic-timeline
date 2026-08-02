import { useState, useRef, useEffect } from "react";
import {
  Music,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Headphones,
  CloudRain,
  Waves,
  Coffee,
  Disc,
} from "lucide-react";

interface Station {
  id: string;
  name: string;
  icon: React.ElementType;
  audioSrc: string;
}

const stations: Station[] = [
  {
    id: "lofi",
    name: "Lofi Hip Hop",
    icon: Headphones,
    audioSrc: "/audio/lofi.mp3",
  },
  { id: "rain", name: "Rain", icon: CloudRain, audioSrc: "/audio/rain.mp3" },
  { id: "ocean", name: "Ocean", icon: Waves, audioSrc: "/audio/ocean.mp3" },
  { id: "coffee", name: "Coffee Shop", icon: Coffee, audioSrc: "/audio/coffee-shop.mp3" },
  { id: "classical", name: "Classical", icon: Disc, audioSrc: "/audio/classical.mp3" },
];

export function MusicPlayer() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(50);
  const [selectedStation, setSelectedStation] = useState<Station>(stations[0]);
  const [playbackMessage, setPlaybackMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  const selectStation = (station: Station) => {
    audioRef.current?.pause();
    setSelectedStation(station);
    setIsPlaying(false);
    setPlaybackMessage(`${station.name} ready.`);
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
  }, [volume]);

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current
          .play()
          .then(() => setPlaybackMessage(`${selectedStation.name} is playing.`))
          .catch(() => {
            setIsPlaying(false);
            setPlaybackMessage("That sound could not start. Try again or choose another.");
          });
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, selectedStation]);

  useEffect(() => {
    if (!isExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isExpanded]);

  return (
    <div className="fixed bottom-8 right-4 z-50 sm:bottom-4">
      {/* Collapsed State */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          aria-label="Open study music"
          aria-expanded="false"
          aria-controls="study-music-panel"
          title="Study music"
          className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
        >
          <Music className="h-5 w-5" />
        </button>
      )}

      {/* Expanded State */}
      {isExpanded && (
        <div
          id="study-music-panel"
          role="region"
          aria-label="Study music player"
          className="bg-background border border-border/60 rounded-2xl shadow-2xl w-72 overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 border-b border-border/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Study Music</span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              aria-label="Close study music"
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
                    onClick={() => selectStation(station)}
                    aria-pressed={selectedStation.id === station.id}
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
              <span className="text-sm font-medium text-foreground" aria-live="polite">
                {selectedStation.name}
              </span>
            </div>
            {playbackMessage && (
              <p className="mt-1 text-[11px] text-muted-foreground" role="status">
                {playbackMessage}
              </p>
            )}
          </div>

          {/* Controls */}
          <div className="p-4 border-t border-border/60 flex items-center gap-3">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause study music" : "Play study music"}
              title={isPlaying ? "Pause study music" : "Play study music"}
              className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>

            <div className="flex-1 flex items-center gap-2">
              <button
                onClick={toggleMute}
                aria-label={volume === 0 ? "Unmute study music" : "Mute study music"}
                title={volume === 0 ? "Unmute study music" : "Mute study music"}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={handleVolumeChange}
                aria-label="Study music volume"
                className="flex-1 h-1 bg-border rounded-full appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Hidden Audio Player for Local Files */}
          <audio
            ref={audioRef}
            src={selectedStation.audioSrc}
            loop
            preload="metadata"
            onEnded={() => setIsPlaying(false)}
          />
        </div>
      )}
    </div>
  );
}
