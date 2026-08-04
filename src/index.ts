import "./styles.css";
import { initiateDialup } from "./modem";
import {
  analyzePipeline,
  MelScale,
  ModemResponseCanvas,
} from "./frequencyVisualizer";
import { ModemTimer, Logger } from "./ui";
import { SpeakerFilter, TelephoneLineFilter } from "./filters";

// Main app entry point
const app = document.getElementById("app");

if (app) {
  app.innerHTML = `
    <header>
      <h1>56kbps Modem</h1>
      <p>Lets go online today</p>
    </header>
    <main>
      <p>After you've connected your modem to a phone line, use the button below to dial into the ISP:</p>
      <button id="connectBtn" class="btn">Connect</button>
      <div id="timer" style="font-family: monospace; font-size: 2rem; color: #0f0; margin-bottom: 10px;">00:00.00</div>
      <div class="visualizer-grid">
        <div class="visualizer-panel">
          <h3>Phone line response</h3>
          <canvas id="phoneResponseCanvas" width="600" height="200" style="width: 100%; display: block;"></canvas>
        </div>
        <div class="visualizer-panel">
          <h3>Speaker response</h3>
          <canvas id="speakerResponseCanvas" width="600" height="200" style="width: 100%; display: block;"></canvas>
        </div>
      </div>
      <div id="log" style="white-space: pre-wrap; font-family: monospace; background: #000; color: #0f0; padding: 10px; height: 200px; overflow-y: auto; margin-top: 15px;"></div>
    </main>
  `;

  const connectBtn = document.getElementById(
    "connectBtn",
  ) as HTMLButtonElement | null;
  const logEl = document.getElementById("log") as HTMLElement;
  const timerEl = document.getElementById("timer") as HTMLElement;
  const phoneCanvasEl = document.getElementById(
    "phoneResponseCanvas",
  ) as HTMLCanvasElement;
  const speakerCanvasEl = document.getElementById(
    "speakerResponseCanvas",
  ) as HTMLCanvasElement;

  const audioCtx = new window.AudioContext({ sampleRate: 48000 });
  const logger = new Logger(logEl);
  const timer = new ModemTimer(timerEl);
  const phoneVisualizer = new ModemResponseCanvas(
    phoneCanvasEl,
    phoneCanvasEl.width,
    phoneCanvasEl.height,
    new MelScale(10, 4000),
    undefined,
    "Phone line (8 kHz)",
  );
  const speakerVisualizer = new ModemResponseCanvas(
    speakerCanvasEl,
    speakerCanvasEl.width,
    speakerCanvasEl.height,
    new MelScale(10, audioCtx.sampleRate / 2),
    undefined,
    "Speaker output (48 kHz)",
  );

  const renderAnalysis = async () => {
    try {
      const [phoneAnalysis, speakerAnalysis] = await Promise.all([
        analyzePipeline((ctx: BaseAudioContext) => {
          const phoneFilter = new TelephoneLineFilter(ctx);
          return { input: phoneFilter.input, output: phoneFilter.output };
        }, 8000),
        analyzePipeline((ctx: BaseAudioContext) => {
          const speakerFilter = new SpeakerFilter(ctx);
          return { input: speakerFilter.input, output: speakerFilter.output };
        }, audioCtx.sampleRate),
      ]);

      phoneVisualizer.draw(phoneAnalysis);
      speakerVisualizer.draw(speakerAnalysis);
      logger.log("Pipeline analyses plotted.");
    } catch (err) {
      logger.log(`Analysis failed: ${err}`);
    }
  };

  renderAnalysis();

  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      connectBtn.disabled = true;

      // Start the visual timer
      timer.reset();
      timer.start();

      const dialup = initiateDialup(audioCtx, logger);
      dialup.completion.finally(() => {
        timer.stop();
        connectBtn.disabled = false;
      });
    });
  }
}

console.log("App initialized");
