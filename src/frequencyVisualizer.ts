import FFT from "fft.js";

export class ModemResponseCanvas {
  private ctx: CanvasRenderingContext2D;

  constructor(
    private canvas: HTMLCanvasElement,
    private width: number = canvas.width,
    private height: number = canvas.height,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  public draw(analysis: AnalysisResult): void {
    const { magnitudes, phases, sampleRate, fftSize } = analysis;

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawGrid(sampleRate, fftSize);

    this.plotData(magnitudes, sampleRate, fftSize, "#00ff00", "magnitude");
    this.plotData(phases, sampleRate, fftSize, "#0088ff", "phase");
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

    const minFreq = 10;
    const maxFreq = 4000;

    for (let x = 0; x < this.width; x++) {
      // 1. Calculate the log frequency for this X pixel
      const freq = minFreq * Math.pow(maxFreq / minFreq, x / (this.width - 1));

      // 2. Find the corresponding FFT bin
      const bin = Math.min(
        data.length - 1,
        Math.floor((freq * fftSize) / sampleRate),
      );

      const val = data[bin];
      let y = 0;

      if (type === "magnitude") {
        const db = 20 * Math.log10(val || 1e-10); // Prevent log(0)
        // Map +20dB to -60dB range to canvas height
        y = this.height / 2 - db * (this.height / 80);
      } else {
        // Map phase (π to -π) to canvas height
        y = this.height / 2 - val * (this.height / (2 * Math.PI));
      }

      x === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
  }

  private drawGrid(sampleRate: number, fftSize: number): void {
    const minFreq = 10;
    const maxFreq = Math.min(4000, sampleRate / 2);
    const dbStep = 5;
    const dbMin = -80;
    const dbMax = 20;
    const logBase = Math.log(maxFreq / minFreq);

    // Background and grid lines
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.font = "10px monospace";
    this.ctx.textBaseline = "middle";

    // Draw horizontal dB grid lines every 5 dB, label every 10 dB
    for (let db = dbMin; db <= dbMax; db += dbStep) {
      const y = this.height / 2 - db * (this.height / 80);
      if (y < 0 || y > this.height) continue;

      this.ctx.beginPath();
      this.ctx.strokeStyle = db % 10 === 0 ? "#444" : "#222";
      this.ctx.lineWidth = db % 10 === 0 ? 1.2 : 1;
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.width, y);
      this.ctx.stroke();

      if (db % 10 === 0) {
        this.ctx.fillStyle = "#aaa";
        this.ctx.fillText(`${db} dB`, 5, y);
      }
    }

    // Draw frequency axis ticks and labels on a logarithmic scale
    const drawFreqX = (freq: number) => {
      const ratio = Math.log(freq / minFreq) / logBase;
      return Math.max(0, Math.min(this.width - 1, ratio * (this.width - 1)));
    };

    const decades = [10, 100, 1000];
    for (const decade of decades) {
      for (let mult = 1; mult <= 9; mult += 1) {
        const freq = decade * mult;
        if (freq > maxFreq) break;

        const x = drawFreqX(freq);
        const isMajor = mult === 1;
        const tickHeight = isMajor ? 12 : 6;

        this.ctx.beginPath();
        this.ctx.strokeStyle = isMajor ? "#888" : "#444";
        this.ctx.lineWidth = 1;
        this.ctx.moveTo(x, this.height - tickHeight - 1);
        this.ctx.lineTo(x, this.height - 1);
        this.ctx.stroke();

        if (isMajor) {
          this.ctx.fillStyle = "#fff";
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "bottom";
          this.ctx.fillText(
            `${freq >= 1000 ? freq / 1000 + "k" : freq}`,
            x,
            this.height - 4,
          );
        }
      }
    }

    if (maxFreq > 1000 && maxFreq !== 1000) {
      const x = drawFreqX(maxFreq);
      this.ctx.beginPath();
      this.ctx.strokeStyle = "#888";
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(x, this.height - 12 - 1);
      this.ctx.lineTo(x, this.height - 1);
      this.ctx.stroke();
      this.ctx.fillStyle = "#fff";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "bottom";
      this.ctx.fillText(
        `${maxFreq >= 1000 ? maxFreq / 1000 + "k" : maxFreq}`,
        x,
        this.height - 4,
      );
    }

    // Unit label and axis base lines
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "bottom";
    this.ctx.fillStyle = "#fff";
    this.ctx.fillText("Frequency (Hz)", 5, this.height - 4);

    this.ctx.strokeStyle = "#888";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(0, this.height - 1);
    this.ctx.lineTo(this.width, this.height - 1);
    this.ctx.stroke();
  }
}

export interface AnalysisResult {
  magnitudes: Float32Array;
  phases: Float32Array;
  sampleRate: number;
  fftSize: number;
}

/**
 * Renders a pipeline offline using an impulse to measure its frequency response.
 */
export async function analyzePipeline(
  buildPipeline: (ctx: BaseAudioContext) => {
    input: AudioNode;
    output: AudioNode;
  },
  sampleRate: number = 44100,
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
  const pipeline = buildPipeline(offlineCtx);
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

  const magnitudes = new Float32Array(fftSize / 2);
  const phases = new Float32Array(fftSize / 2);

  for (let i = 0; i < fftSize / 2; i++) {
    const real = outComplex[2 * i];
    const imag = outComplex[2 * i + 1];

    magnitudes[i] = Math.sqrt(real * real + imag * imag);
    phases[i] = Math.atan2(imag, real);
  }

  return { magnitudes, phases, sampleRate, fftSize };
}
