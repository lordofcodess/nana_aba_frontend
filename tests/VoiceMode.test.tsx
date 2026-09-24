// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VoiceMode from "../src/VoiceMode";
import { ragChatStream, ttsSpeak, voiceConverse, transcribeVoice } from "../src/api";

vi.mock("../src/api", () => ({
  transcribeVoice: vi.fn(), voiceConverse: vi.fn(),
  ragChatStream: vi.fn(), ttsSpeak: vi.fn(),
}));

const resume = vi.fn();
const decode = vi.fn();
const start = vi.fn();
const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const recording = vi.fn();
let microphoneSample = 128;
const stream = { getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [{ enabled: true }] } as unknown as MediaStream;

class TestAudioContext {
  state = "running";
  destination = {};
  resume = resume;
  close = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = decode;
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createAnalyser = () => ({ fftSize: 1024, getByteTimeDomainData: (data: Uint8Array) => data.fill(microphoneSample) });
  createBufferSource = () => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn(), start, stop: vi.fn(), onended: null });
}
class TestRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = "recording"; recording(); }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(5000)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

async function flush() { await act(async () => { await Promise.resolve(); }); }
function openVoice(strict = false) {
  const view = <VoiceMode onClose={vi.fn()} sidebarOpen={false} onToggleSidebar={vi.fn()} />;
  return render(strict ? <StrictMode>{view}</StrictMode> : view);
}
async function typeMessage() {
  const input = screen.getByRole("textbox", { name: /Message Nana Aba/ });
  fireEvent.change(input, { target: { value: "Hello" } });
  fireEvent.submit(input.closest("form")!);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  microphoneSample = 128;
  resume.mockResolvedValue(undefined);
  decode.mockResolvedValue({});
  getUserMedia.mockResolvedValue(stream);
  vi.stubGlobal("AudioContext", TestAudioContext);
  vi.stubGlobal("MediaRecorder", TestRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  Element.prototype.scrollTo = vi.fn();
  vi.mocked(ragChatStream).mockImplementation(async (_query, _history, _mode, onEvent) => {
    onEvent({ type: "delta", text: "Hello there." });
  });
  vi.mocked(ttsSpeak).mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) } as Blob);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("voice startup and playback recovery", () => {
  it("times out suspended audio and activates it on an orb tap", async () => {
    resume.mockImplementationOnce(() => new Promise(() => {}));
    openVoice();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText("Tap to start voice")).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tap the orb to activate voice audio." }));
    await flush();
    expect(recording).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Listening — go ahead" })).toBeTruthy();
  });

  it("lets the orb recover while startup is still pending", async () => {
    resume.mockImplementationOnce(() => new Promise(() => {}));
    openVoice();
    fireEvent.click(screen.getByRole("button", { name: "Starting…" }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText("Tap to start voice")).toBeNull();
    expect(recording).toHaveBeenCalledOnce();
  });

  it("times out ignored microphone permission and stops a late stream", async () => {
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    openVoice();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByText("Microphone unavailable")).toBeTruthy();
    await act(async () => { resolve(stream); });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recording).not.toHaveBeenCalled();
  });

  it("releases microphone permission arriving after close", async () => {
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const view = openVoice();
    await flush();
    view.unmount();
    await act(async () => { resolve(stream); });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recording).not.toHaveBeenCalled();
  });

  it("starts only one recorder under React StrictMode", async () => {
    openVoice(true);
    await flush();
    expect(recording).toHaveBeenCalledOnce();
  });

  it("replays retained audio after failure without another server request", async () => {
    openVoice();
    await flush();
    decode.mockRejectedValueOnce(new Error("Audio decode failed"));
    await typeMessage();
    expect(screen.getByText("Hello there.")).toBeTruthy();
    expect(screen.getByText("Reply audio paused")).toBeTruthy();
    expect(screen.queryByText("Microphone unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Tap the orb to play the reply again/ }));
    await flush();
    expect(start).toHaveBeenCalledOnce();
    expect(ttsSpeak).toHaveBeenCalledOnce();
    expect(ragChatStream).toHaveBeenCalledOnce();
  });

  it("does not play a reply decoded after the session closes", async () => {
    let resolve!: (value: AudioBuffer) => void;
    decode.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const view = openVoice();
    await flush();
    await typeMessage();
    view.unmount();
    await act(async () => { resolve({} as AudioBuffer); });
    expect(start).not.toHaveBeenCalled();
  });
});


describe("recorded voice turns", () => {
  it("shows the request failure instead of hiding it behind a generic message", async () => {
    vi.mocked(voiceConverse).mockRejectedValue(new Error("Voice service unavailable (503)"));
    openVoice();
    await flush();
    microphoneSample = 144;
    await act(async () => { await vi.advanceTimersByTimeAsync(90); });
    microphoneSample = 128;
    await act(async () => { await vi.advanceTimersByTimeAsync(1530); });
    expect(screen.getByText("Voice reply interrupted")).toBeTruthy();
    expect(screen.getByText(/Voice service unavailable \(503\)/)).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });

  it("lets the user send quiet speech without waiting for automatic detection", async () => {
    vi.mocked(voiceConverse).mockResolvedValue({
      transcript: "A quiet question", answer: "Here is your answer.",
      audio_b64: "AAAA", mime: "audio/wav", sample_rate: 24000, via_web: false,
    });
    openVoice();
    await flush();
    microphoneSample = 130;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(voiceConverse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Listening — go ahead" }));
    await flush();
    expect(voiceConverse).toHaveBeenCalledOnce();
    expect(screen.getByText("A quiet question")).toBeTruthy();
    expect(start).toHaveBeenCalledOnce();
  });

  it("uses the original combined endpoint without depending on separate transcription", async () => {
    vi.mocked(voiceConverse).mockResolvedValue({
      transcript: "Where is the library?", answer: "The library is on campus.",
      audio_b64: "AAAA", mime: "audio/wav", sample_rate: 24000, via_web: false,
    });
    openVoice();
    await flush();
    microphoneSample = 144;
    await act(async () => { await vi.advanceTimersByTimeAsync(90); });
    microphoneSample = 128;
    await act(async () => { await vi.advanceTimersByTimeAsync(1530); });
    expect(voiceConverse).toHaveBeenCalledOnce();
    expect(transcribeVoice).not.toHaveBeenCalled();
    expect(screen.getByText("Where is the library?")).toBeTruthy();
    expect(screen.getByText("The library is on campus.")).toBeTruthy();
    expect(start).toHaveBeenCalledOnce();
  });
});
