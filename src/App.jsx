import { useRef, useState, useEffect } from "react";
import { parseBlob } from "music-metadata-browser";
import "./App.css";

const DEFAULT_POSTER = "https://cdn-icons-png.flaticon.com/512/727/727245.png"; // fallback image

function getTrackInfoFromFilename(fileName) {
  const name = fileName.replace(/\.[^/.]+$/, "");
  const [artist, title] = name.includes(" - ")
    ? name.split(" - ", 2)
    : [null, name];
  return { artist, title };
}

async function extractTrackMeta(file) {
  let raw;
  try {
    raw = await parseBlob(file);
  } catch (err) {
    console.error("ParseBlob failed", err);
    // true parsing failure: fallback ONLY to filename
    const { artist, title } = getTrackInfoFromFilename(file.name);
    return {
      name: file.name,
      url: URL.createObjectURL(file),
      poster: null,
      artist,
      title,
      album: null,
      year: null,
    };
  }

  // Once here, raw is valid—even if some common tags are missing.
  console.log("[META] Full metadata for", file.name, raw); // Log full metadata object
  const common = raw.common;
  // Title fallback to filename if missing
  let title = common.title || getTrackInfoFromFilename(file.name).title;
  let artist = common.artist || getTrackInfoFromFilename(file.name).artist;
  let album = common.album || "Unknown Album";
  let year = common.year || "Unknown Year";
  let poster = null;
  if (common.picture?.length) {
    try {
      const pic = common.picture[0];
      const blob = new Blob([pic.data], { type: pic.format });
      poster = URL.createObjectURL(blob);
    } catch (picErr) {
      console.warn("Couldn’t parse picture", picErr);
      // but don’t bungle the rest of the tags
    }
  }
  return {
    name: file.name,
    url: URL.createObjectURL(file),
    poster,
    artist,
    title,
    album,
    year,
  };
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function App() {
  const [tracks, setTracks] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const audioRef = useRef(null);
  const [googleDriveLink, setGoogleDriveLink] = useState("");

  // Robust file ID extraction for Google Drive links
  const extractDriveFileId = (url) => {
    const patterns = [
      /\/d\/([a-zA-Z0-9_-]{25,})/, // .../d/FILEID/...
      /id=([a-zA-Z0-9_-]{25,})/, // ...id=FILEID
      /file\/d\/([a-zA-Z0-9_-]{25,})/, // ...file/d/FILEID/...
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  useEffect(() => {
    // On unmount, revoke all object URLs to avoid memory leaks
    return () => {
      tracks.forEach((track) => {
        URL.revokeObjectURL(track.url);
        if (track.poster) {
          URL.revokeObjectURL(track.poster);
        }
      });
    };
  }, [tracks]); // Re-run when tracks change to capture the latest list

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    // Accept all audio files, including those from subfolders and with empty type but valid extension
    const audioExtensions = [
      ".mp3",
      ".wav",
      ".ogg",
      ".flac",
      ".aac",
      ".m4a",
      ".opus",
      ".webm",
    ];
    const audioFiles = files.filter((file) => {
      if (file.type && file.type.startsWith("audio/")) return true;
      const lower = file.name.toLowerCase();
      return audioExtensions.some((ext) => lower.endsWith(ext));
    });
    // Find duplicates
    const duplicateFiles = audioFiles.filter((file) =>
      tracks.some(
        (track) =>
          track.name === file.name &&
          track.size === file.size &&
          track.lastModified === file.lastModified
      )
    );
    // Filter out files that are already in tracks (by name, size, and lastModified)
    const uniqueFiles = audioFiles.filter((file) => {
      return !tracks.some(
        (track) =>
          track.name === file.name &&
          track.size === file.size &&
          track.lastModified === file.lastModified
      );
    });
    if (duplicateFiles.length > 0) {
      alert(
        `The following file(s) already exist in your playlist and were not added again:\n` +
          duplicateFiles.map((f) => f.name).join("\n")
      );
    }
    const newTracks = [];
    for (const file of uniqueFiles) {
      const meta = await extractTrackMeta(file);
      // Attach file properties for future duplicate checks
      meta.size = file.size;
      meta.lastModified = file.lastModified;
      meta.name = file.name;
      console.log("[UPLOAD] Track meta:", meta); // Log all details
      newTracks.push(meta);
    }
    setTracks((prev) => [...prev, ...newTracks]);
    if (!currentTrack && newTracks.length > 0) {
      setCurrentTrack(newTracks[0]);
      console.log("[UPLOAD] Set current track:", newTracks[0]);
    }
    e.target.value = ""; // <-- Add this line
  };

  const handleGoogleDriveAdd = async () => {
    if (!googleDriveLink) return;
    try {
      const response = await fetch("http://localhost:3003/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: googleDriveLink }),
      });
      if (!response.ok) {
        let errorText = "";
        try {
          errorText = await response.text();
        } catch {}
        throw new Error(
          `Server error: ${response.status} ${response.statusText}\n${errorText}`
        );
      }
      const blob = await response.blob();
      // Try to get filename from headers, fallback to a default
      let fileName = "drive-audio.mp3";
      const disposition = response.headers.get("Content-Disposition");
      if (disposition) {
        const fileNameMatch = disposition.match(/filename="(.+)"/);
        if (fileNameMatch) fileName = fileNameMatch[1];
      }
      const file = new File([blob], fileName, { type: blob.type });
      const meta = await extractTrackMeta(file);
      meta.size = blob.size;
      meta.lastModified = Date.now();
      meta.name = fileName;
      setTracks((prev) => [...prev, meta]);
      if (!currentTrack) setCurrentTrack(meta);
      setGoogleDriveLink("");
    } catch (err) {
      let serverError = err && err.message ? err.message : err;
      alert("Failed to add file from Google Drive: " + serverError);
    }
  };

  const handlePlayPause = () => {
    if (!currentTrack) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTrackSelect = (track) => {
    setCurrentTrack(track);
    setAutoPlayNext(true);
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      setProgress(0);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
  };

  const handleNext = () => {
    if (!currentTrack || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.url === currentTrack.url);
    const nextIdx = (idx + 1) % tracks.length;
    handleTrackSelect(tracks[nextIdx]);
  };

  const handlePrev = () => {
    if (!currentTrack || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.url === currentTrack.url);
    const prevIdx = (idx - 1 + tracks.length) % tracks.length;
    handleTrackSelect(tracks[prevIdx]);
  };

  return (
    <div className="music-player-layout">
      <div className="music-player-glass">
        <h1 style={{ marginBottom: "0.5rem" }}>Music Player</h1>
        <div className="showcase">
          <img
            className="track-poster"
            src={currentTrack?.poster || DEFAULT_POSTER}
            alt="Track Poster"
          />
          <div className="track-info">
            <div className="track-title">
              {currentTrack?.title || "Unknown Title"}
            </div>
            {currentTrack?.artist && (
              <div className="track-artist">{currentTrack.artist}</div>
            )}
          </div>
        </div>
        <div className="player-controls">
          <div className="controls-row">
            <button
              onClick={handlePrev}
              disabled={!currentTrack || tracks.length < 2}
              className="icon-btn small"
            >
              <span role="img" aria-label="Previous">
                &#9198;
              </span>
            </button>
            <button
              onClick={handlePlayPause}
              disabled={!currentTrack}
              className="icon-btn"
            >
              {isPlaying ? (
                <span role="img" aria-label="Pause">
                  &#10073;&#10073;
                </span>
              ) : (
                <span role="img" aria-label="Play">
                  &#9654;
                </span>
              )}
            </button>
            <button
              onClick={handleNext}
              disabled={!currentTrack || tracks.length < 2}
              className="icon-btn small"
            >
              <span role="img" aria-label="Next">
                &#9197;
              </span>
            </button>
          </div>
          <div className="seek-row">
            <span className="timer">{formatTime(progress)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={progress}
              onChange={handleSeek}
              disabled={!currentTrack}
              className="seek-bar"
            />
            <span className="timer">{formatTime(duration)}</span>
          </div>
          <div className="volume-row">
            <span className="volume-icon" role="img" aria-label="Volume">
              &#128266;
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={handleVolumeChange}
            />
            <span
              style={{
                marginLeft: "0.5em",
                minWidth: "2.5em",
                color: "#fff",
                fontSize: "0.98em",
                textAlign: "right",
                display: "inline-block",
              }}
            >
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>
        {currentTrack && (
          <audio
            ref={audioRef}
            src={currentTrack.url}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            onLoadedMetadata={() => {
              setDuration(audioRef.current.duration);
              if (autoPlayNext) {
                audioRef.current.play();
                setIsPlaying(true);
                setAutoPlayNext(false);
              }
            }}
          />
        )}
      </div>
      <div className="music-list-panel">
        <h2>Your Music</h2>
        <div
          className="track-count"
          style={{ color: "#bbb", fontSize: "0.98em", marginBottom: "0.7em" }}
        >
          {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
        </div>
        <div className="upload-section">
          <label className="upload-label" htmlFor="file-upload">
            Upload audio file(s)
          </label>
          <input
            id="file-upload"
            type="file"
            accept="audio/*"
            multiple
            onChange={handleUpload}
            style={{ display: "none" }}
          />
          <button
            className="upload-btn"
            onClick={() => document.getElementById("file-upload").click()}
            type="button"
          >
            Choose File(s)
          </button>
          <div className="upload-divider">or</div>
          <div className="gdrive-link-container">
            <span className="gdrive-icon" title="Google Drive">
              {/* Google Drive SVG */}
            </span>
            <input
              type="text"
              className="gdrive-link-input"
              placeholder="Paste Google Drive link"
              value={googleDriveLink}
              onChange={(e) => setGoogleDriveLink(e.target.value)}
            />
            <button
              className="gdrive-link-btn"
              onClick={handleGoogleDriveAdd}
              disabled={!googleDriveLink}
              style={{ marginTop: "0.5em" }}
            >
              Add from Drive
            </button>
          </div>
        </div>
        <div className="track-list">
          {tracks.length === 0 && <p>No tracks uploaded yet.</p>}
          {tracks.map((track, idx) => (
            <div
              key={track.url}
              className={`track-item${
                currentTrack && currentTrack.url === track.url ? " active" : ""
              }`}
              onClick={() => handleTrackSelect(track)}
            >
              <span className="track-list-title">{track.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
