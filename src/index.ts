import "./styles.css";
import { initiateDialup } from "./modem";
import { analyzePipeline, ModemResponseCanvas } from "./frequencyVisualizer";
import { ModemTimer, Logger } from "./ui";
import {
  FullModemFilter,
  SpeakerFilter,
  SoftSaturationShaper,
  TelephoneLineFilter,
} from "./filters";

// Main app entry point
const app = document.getElementById("app");

if (app) {
  app.innerHTML = `
    <header>
      <h1>56kbps Modem</h1>
      <p>The Siren's song of the dial-up era</p>
    </header>
    <main>
      <div id="timer" style="font-family: monospace; font-size: 2rem; color: #0f0; margin-bottom: 10px;">00:00.00</div>
      <canvas id="responseCanvas" width="600" height="200" style="width: 100%; display: block;"></canvas>
      <p>Click below to initiate dial-up connection:</p>
      <button id="connectBtn">Connect</button>
      <div id="log" style="white-space: pre-wrap; font-family: monospace; background: #000; color: #0f0; padding: 10px; height: 200px; overflow-y: auto; margin-top: 15px;"></div>
    </main>
  `;

  const connectBtn = document.getElementById(
    "connectBtn",
  ) as HTMLButtonElement | null;
  const logEl = document.getElementById("log") as HTMLElement;
  const timerEl = document.getElementById("timer") as HTMLElement;
  const canvasEl = document.getElementById(
    "responseCanvas",
  ) as HTMLCanvasElement;

  const audioCtx = new window.AudioContext({ sampleRate: 8000 });
  const logger = new Logger(logEl);
  const timer = new ModemTimer(timerEl);
  const visualizer = new ModemResponseCanvas(canvasEl);

  const renderAnalysis = async () => {
    try {
      const analysisData = await analyzePipeline((ctx: BaseAudioContext) => {
        //const modemFilter = new SpeakerFilter(ctx);
        const modemFilter = new FullModemFilter(ctx);
        return { input: modemFilter.input, output: modemFilter.output };
      }, audioCtx.sampleRate);
      visualizer.draw(analysisData);
      logger.log("Pipeline analysis plotted.");
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
