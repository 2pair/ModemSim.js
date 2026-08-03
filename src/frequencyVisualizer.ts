import FFT from "fft.js";

import { magnitudeToDb } from "./filters";

export interface FrequencyScale {
  readonly name: string;
  readonly minFreq: number;
  readonly maxFreq: number;

  /** Converts a frequency (Hz) to a normalized ratio (0.0 to 1.0) */
  freqToRatio(freq: number): number;

  /** Converts a normalized ratio (0.0 to 1.0) back to a frequency (Hz) */
  ratioToFreq(ratio: number): number;
}

export class MelScale implements FrequencyScale {
  public readonly name = "Mel Scale";
  private minMel: number;
  private melRange: number;

  constructor(
    public readonly minFreq: number,
    public readonly maxFreq: number,
  ) {
    this.minMel = this.hzToMel(minFreq);
    const maxMel = this.hzToMel(maxFreq);
    this.melRange = maxMel - this.minMel;
  }

  private hzToMel(hz: number): number {
    return 1127 * Math.log(1 + hz / 700);
  }

  private melToHz(mel: number): number {
    return 700 * (Math.exp(mel / 1127) - 1);
  }

  public freqToRatio(freq: number): number {
    const mel = this.hzToMel(freq);
    return (mel - this.minMel) / this.melRange;
  }

  public ratioToFreq(ratio: number): number {
    const mel = this.minMel + ratio * this.melRange;
    return this.melToHz(mel);
  }
}

export class LogScale implements FrequencyScale {
  public readonly name = "Log Scale";
  private minLog: number;
  private logRange: number;

  constructor(
    public readonly minFreq: number,
    public readonly maxFreq: number,
  ) {
    this.minLog = Math.log(minFreq);
    const maxLog = Math.log(maxFreq);
    this.logRange = maxLog - this.minLog;
  }

  public freqToRatio(freq: number): number {
    return (Math.log(freq) - this.minLog) / this.logRange;
  }

  public ratioToFreq(ratio: number): number {
    return Math.exp(this.minLog + ratio * this.logRange);
  }
}

export interface MagnitudeScale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;

  /** Converts a linear FFT magnitude to a normalized Y ratio (0.0 = bottom, 1.0 = top) */
  magnitudeToRatio(val: number): number;

  /** Converts a specific scale value (like dB) to a normalized Y ratio */
  valueToRatio(value: number): number;
}

export class DecibelScale implements MagnitudeScale {
  public readonly unit = "dB";
  private range: number;

  constructor(
    public readonly min: number,
    public readonly max: number,
    public readonly step: number,
  ) {
    this.range = this.max - this.min;
  }

  public magnitudeToRatio(val: number): number {
    const db = magnitudeToDb(val || 1e-10); // Prevent log(0)
    return this.valueToRatio(db);
  }

  public valueToRatio(db: number): number {
    // Returns 0.0 at min dB, and 1.0 at max dB
    return (db - this.min) / this.range;
  }
}

export class ModemResponseCanvas {
  private ctx: CanvasRenderingContext2D;
  public freqScale: FrequencyScale;
  public magScale: MagnitudeScale;

  constructor(
    private canvas: HTMLCanvasElement,
    private width: number = canvas.width,
    private height: number = canvas.height,
    freqScale?: FrequencyScale,
    magScale?: MagnitudeScale,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.freqScale = freqScale ?? new MelScale(10, 10000);
    // You can now easily swap these limits at instantiation!
    this.magScale = magScale ?? new DecibelScale(-60, 10, 10);
  }

  public draw(analysis: AnalysisResult): void {
    const { phases, magnitudes, sampleRate, fftSize } = analysis;

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawGrid();

    this.plotData(phases, sampleRate, fftSize, "#0088ff", "phase");
    this.plotData(magnitudes, sampleRate, fftSize, "#00ff00", "magnitude");
  }

  private plotData(
    data: Float32Array,
    sampleRate: number,
    fftSize: number,
    color: string,
    type: "magnitude" | "phase",
  ): void {
    this.ctx.beginPath();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;

    for (let x = 0; x < this.width; x++) {
      const ratioX = x / (this.width - 1);
      const freq = this.freqScale.ratioToFreq(ratioX);

      const bin = Math.min(
        data.length - 1,
        Math.floor((freq * fftSize) / sampleRate),
      );

      const val = data[bin]!;
      let y: number;

      if (type === "magnitude") {
        // The Y-axis abstraction replaces the hardcoded dB math
        const ratioY = this.magScale.magnitudeToRatio(val);
        // Canvas Y is inverted (0 is top), so we do 1 - ratio
        y = this.height * (1 - ratioY);
      } else {
        // Phase math can remain hardcoded, or you can build a PhaseScale abstraction!
        y = this.height / 2 - val * (this.height / (2 * Math.PI));
      }

      if (x === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();
  }

  private drawGrid(): void {
    const { ctx, width, height, freqScale, magScale } = this;

    // Background
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    ctx.font = "10px monospace";

    // 1. Draw horizontal magnitude grid lines & labels (Left Side)
    ctx.textBaseline = "middle";
    for (let val = magScale.min; val <= magScale.max; val += magScale.step) {
      const ratioY = magScale.valueToRatio(val);
      const y = height * (1 - ratioY);

      if (y < 0 || y > height) continue;

      ctx.beginPath();
      ctx.strokeStyle = val === 0 ? "#666" : "#222";
      ctx.lineWidth = val === 0 ? 1.5 : 1;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = "#aaa";
      ctx.textAlign = "left";
      ctx.fillText(`${val} ${magScale.unit}`, 5, y);
    }

    // 2. Draw Phase labels (Right Side)
    // Matches the blue phase line color so the user instantly connects them visually
    ctx.fillStyle = "#0088ff";
    ctx.textAlign = "right";

    const phaseLabels = [
      { text: "180°", y: 2, baseline: "top" as CanvasTextBaseline },
      { text: "0°", y: height / 2, baseline: "middle" as CanvasTextBaseline },
      {
        text: "-180°",
        y: height - 2,
        baseline: "bottom" as CanvasTextBaseline,
      },
    ];

    for (const label of phaseLabels) {
      ctx.textBaseline = label.baseline;
      ctx.fillText(label.text, width - 5, label.y);
    }

    // 3. Draw frequency axis ticks using the scale abstraction (Bottom Side)
    const drawFreqX = (freq: number) => {
      const ratio = freqScale.freqToRatio(freq);
      return Math.max(0, Math.min(width - 1, ratio * (width - 1)));
    };

    const drawTick = (freq: number, isMajor: boolean) => {
      const x = drawFreqX(freq);
      const tickHeight = isMajor ? 12 : 6;

      ctx.beginPath();
      ctx.strokeStyle = isMajor ? "#a6a6a6" : "#b1b1b1";
      ctx.lineWidth = 1;
      ctx.moveTo(x, height - tickHeight - 1);
      ctx.lineTo(x, height - 1);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
        ctx.fillText(label, x, height - 14);
      }
    };

    const decades = [10, 100, 1000, 10000];
    for (const decade of decades) {
      for (let mult = 1; mult <= 9; mult += 1) {
        const freq = decade * mult;
        if (freq > freqScale.maxFreq) break;
        if (freq < freqScale.minFreq) continue;

        drawTick(freq, mult === 1);
      }
    }

    if (!decades.includes(freqScale.maxFreq)) {
      drawTick(freqScale.maxFreq, true);
    }

    // 4. Axis base lines and Dynamic Unit label
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, height - 1);
    ctx.lineTo(width, height - 1);
    ctx.stroke();

    // Centered at the top to prevent overlapping with either the dB or Degree margins
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.fillText(`Frequency (Hz) [${freqScale.name}]`, width / 2, 5);
  }
}

class PhaseArray extends Float32Array {}
class MagnitudeArray extends Float32Array {}

export interface AnalysisResult {
  phases: PhaseArray;
  magnitudes: MagnitudeArray;
  sampleRate: number;
  fftSize: number;
}

/**
 * Renders a pipeline offline using an impulse to measure its frequency response.
 */
export async function analyzePipeline(
  filterPipeline: (ctx: BaseAudioContext) => {
    input: AudioNode;
    output: AudioNode;
  },
  sampleRate: number = 8000,
): Promise<AnalysisResult> {
  // 1. Create Offline Context (1 second is plenty for an impulse response)
  const duration = 1.0;
  const offlineCtx = new OfflineAudioContext(
    1,
    sampleRate * duration,
    sampleRate,
  );

  // 2. Create the Impulse (Dirac delta)
  const impulseBuffer = offlineCtx.createBuffer(
    1,
    offlineCtx.length,
    sampleRate,
  );
  impulseBuffer.getChannelData(0)[0] = 1.0;

  const source = offlineCtx.createBufferSource();
  source.buffer = impulseBuffer;

  // 3. Build and connect the user's pipeline
  const pipeline = filterPipeline(offlineCtx);
  source.connect(pipeline.input);
  pipeline.output.connect(offlineCtx.destination);

  // 4. Render the audio
  source.start();
  const renderedBuffer = await offlineCtx.startRendering();
  const outputData = renderedBuffer.getChannelData(0);

  // 5. Calculate FFT (Ensure size is a power of 2 and fits the rendered buffer)
  const desiredFftSize = 8192;
  const fftSize = Math.min(
    desiredFftSize,
    1 << Math.floor(Math.log2(outputData.length)),
  );
  const f = new FFT(fftSize);
  const outComplex = f.createComplexArray();

  // Take the first `fftSize` samples from the impulse response, zero-padding if needed.
  const inputSlice = new Float32Array(fftSize);
  inputSlice.set(outputData.subarray(0, Math.min(outputData.length, fftSize)));
  f.realTransform(outComplex, inputSlice);

  const magnitudes = new MagnitudeArray(fftSize / 2);
  const phases = new PhaseArray(fftSize / 2);

  for (let i = 0; i < fftSize / 2; i++) {
    const real = outComplex[2 * i];
    const imag = outComplex[2 * i + 1];

    magnitudes[i] = Math.sqrt(real * real + imag * imag);
    phases[i] = Math.atan2(imag, real);
  }

  return { phases, magnitudes, sampleRate, fftSize };
}
