#!/usr/bin/env python3
"""
transcribe.py — offline mock-interview answer analysis (faster-whisper).

Transcribes a voice memo with WORD-LEVEL timestamps and reports the delivery
signal that a plain transcript loses: pace (WPM), pauses/stalls, filler words,
and stutters/repeats — plus the verbatim text. Runs fully local; nothing is
uploaded. PyAV (bundled with faster-whisper) decodes .m4a/.mp3/.wav directly,
so no ffmpeg is required.

Usage:
  ~/.hireloom-whisper/bin/python interview-prep/transcribe.py <audio> [<audio> ...]
  ~/.hireloom-whisper/bin/python interview-prep/transcribe.py interview-prep/recordings/

Env:
  WHISPER_MODEL   model size (default: small.en). Options: base.en, small.en, medium.en
"""
import os, sys, json, re, glob

MODEL = os.environ.get("WHISPER_MODEL", "small.en")
AUDIO_EXTS = (".m4a", ".mp3", ".wav", ".aac", ".caf", ".aiff", ".flac", ".mp4", ".mov")

# --- filler / disfluency lexicons -------------------------------------------
HARD_FILLERS = {"um", "uh", "er", "ah", "mm", "hmm", "uhm", "umm", "mhm", "eh"}
SOFT_FILLERS = {"like", "basically", "actually", "literally", "honestly",
                "obviously", "essentially", "right", "so"}
# multi-word soft fillers checked on the joined text
PHRASE_FILLERS = ["you know", "i mean", "kind of", "sort of", "i guess",
                  "i think", "i feel", "i believe", "a little bit"]

PAUSE_BEAT = 0.6     # >= this = a noticeable pause
PAUSE_STALL = 1.2    # >= this = a stall worth flagging hard


def norm(w):
    return re.sub(r"[^a-z']", "", w.strip().lower())


def analyze(path, model):
    segments, info = model.transcribe(
        path, word_timestamps=True, vad_filter=False, beam_size=5,
        condition_on_previous_text=False,
    )
    words = []
    text_parts = []
    for seg in segments:
        text_parts.append(seg.text)
        for w in (seg.words or []):
            words.append({"word": w.word, "raw": norm(w.word),
                          "start": round(w.start, 2), "end": round(w.end, 2)})
    transcript = "".join(text_parts).strip()

    if not words:
        return {"file": os.path.basename(path), "error": "no speech detected",
                "transcript": transcript}

    # "keep rolling" workflow: trim false-starts before a spoken marker phrase.
    # Takes the LAST occurrence so restarts after the marker are handled too.
    trim_note = None
    marker = os.environ.get("START_AFTER", "").strip().lower()
    if marker:
        toks = marker.split()
        raws = [w["raw"] for w in words]
        last = None
        for i in range(len(raws) - len(toks) + 1):
            if raws[i:i + len(toks)] == toks:
                last = i
        if last is not None and last > 0:
            trim_note = f"trimmed {last} words ({round(words[last]['start'], 1)}s) of false starts before the marker"
            words = words[last:]
            transcript = "".join(w["word"] for w in words).strip()
        elif last is None:
            trim_note = f"marker '{marker}' NOT found — analyzed FULL clip (check the phrasing)"

    speak_start, speak_end = words[0]["start"], words[-1]["end"]
    dur = max(0.01, speak_end - speak_start)
    n = len(words)
    wpm = round(n / (dur / 60.0))

    # pauses (gap between end of one word and start of next)
    pauses = []
    for i in range(1, n):
        gap = round(words[i]["start"] - words[i - 1]["end"], 2)
        if gap >= PAUSE_BEAT:
            pauses.append({
                "gap": gap,
                "after": words[i - 1]["word"].strip(),
                "before": words[i]["word"].strip(),
                "at": words[i - 1]["end"],
            })
    pauses_sorted = sorted(pauses, key=lambda p: -p["gap"])
    total_pause = round(sum(p["gap"] for p in pauses), 1)

    # fillers
    hard = [w for w in words if w["raw"] in HARD_FILLERS]
    soft = [w for w in words if w["raw"] in SOFT_FILLERS]
    low = " " + " ".join(w["raw"] for w in words) + " "
    phrase_hits = {ph: len(re.findall(r"(?<![a-z])" + ph.replace(" ", r"\s+") + r"(?![a-z])", low))
                   for ph in PHRASE_FILLERS}
    phrase_hits = {k: v for k, v in phrase_hits.items() if v}

    # stutters: same normalized word twice in a row
    stutters = []
    for i in range(1, n):
        if words[i]["raw"] and words[i]["raw"] == words[i - 1]["raw"]:
            stutters.append({"word": words[i]["raw"], "at": words[i]["start"]})

    return {
        "file": os.path.basename(path),
        "model": MODEL,
        "trim_note": trim_note,
        "duration_sec": round(dur, 1),
        "word_count": n,
        "wpm": wpm,
        "pace_band": ("slow <120" if wpm < 120 else
                      "conversational 120-160" if wpm <= 160 else
                      "brisk 161-175" if wpm <= 175 else "RACING >175"),
        "pauses_ge_0.6s": len(pauses),
        "total_pause_sec": total_pause,
        "longest_pauses": pauses_sorted[:8],
        "stalls_ge_1.2s": [p for p in pauses_sorted if p["gap"] >= PAUSE_STALL],
        "fillers": {
            "hard_count": len(hard),
            "hard_list": [w["raw"] for w in hard],
            "soft_count": len(soft),
            "soft_breakdown": {k: [w["raw"] for w in soft].count(k)
                               for k in sorted(set(w["raw"] for w in soft))},
            "phrase_hits": phrase_hits,
            "fillers_per_min": round((len(hard) + len(soft) + sum(phrase_hits.values())) / (dur / 60.0), 1),
        },
        "stutters": stutters,
        "transcript": transcript,
    }


def fmt(a):
    if a.get("error"):
        return f"\n=== {a['file']} ===\n  ⚠ {a['error']}\n  transcript: {a.get('transcript','')}\n"
    L = [f"\n=== {a['file']} ===  (model: {a['model']})"]
    if a.get("trim_note"):
        L.append(f"  ✂  {a['trim_note']}")
    L.append(f"  ⏱  {a['duration_sec']}s spoken · {a['word_count']} words · {a['wpm']} wpm [{a['pace_band']}]")
    L.append(f"  ⏸  {a['pauses_ge_0.6s']} pauses ≥0.6s · {a['total_pause_sec']}s total silence")
    if a["longest_pauses"]:
        L.append("     longest:")
        for p in a["longest_pauses"]:
            L.append(f"       {p['gap']}s — after \"{p['after']}\" → before \"{p['before']}\"  (@{p['at']}s)")
    f = a["fillers"]
    L.append(f"  🗣  fillers: {f['hard_count']} hard {f['hard_list']} · {f['soft_count']} soft {f['soft_breakdown']}")
    if f["phrase_hits"]:
        L.append(f"      phrases: {f['phrase_hits']}")
    L.append(f"      => {f['fillers_per_min']} fillers/min")
    if a["stutters"]:
        L.append(f"  🔁 stutters/repeats: {[s['word'] for s in a['stutters']]}")
    L.append(f"\n  TRANSCRIPT:\n  {a['transcript']}\n")
    return "\n".join(L)


def main():
    args = sys.argv[1:]
    if not args:
        print("usage: transcribe.py <audio|dir> [...]"); sys.exit(1)
    paths = []
    for a in args:
        if os.path.isdir(a):
            for e in AUDIO_EXTS:
                paths += sorted(glob.glob(os.path.join(a, "*" + e)))
        elif os.path.isfile(a):
            paths.append(a)
        else:
            print(f"  ! not found: {a}", file=sys.stderr)
    if not paths:
        print("no audio files found"); sys.exit(1)

    from faster_whisper import WhisperModel
    print(f"loading model {MODEL} (first run downloads it; cached after)...", file=sys.stderr)
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")

    results = []
    for p in paths:
        print(f"transcribing {os.path.basename(p)} ...", file=sys.stderr)
        a = analyze(p, model)
        results.append(a)
        print(fmt(a))
        with open(p + ".analysis.json", "w") as fh:
            json.dump(a, fh, indent=2)
    # combined json next to first file's dir for the assistant to read
    out = os.path.join(os.path.dirname(paths[0]) or ".", "_last-analysis.json")
    with open(out, "w") as fh:
        json.dump(results, fh, indent=2)
    print(f"\n[json dump: {out}]", file=sys.stderr)


if __name__ == "__main__":
    main()
