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
      {/* Social Media Navbar */}
      <nav className="social-navbar">
        <div className="social-navbar-content">
          <div className="social-links">
            <a
              href="https://github.com/SakshamDev2005"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              title="GitHub"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
            <a
              href="https://instagram.com/hii_saksham"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              title="Instagram"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
            </a>
            <a
              href="https://linkedin.com/in/saksham2005"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              title="LinkedIn"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
          </div>
        </div>
      </nav>

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
