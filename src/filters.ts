export interface AudioFilter {
  input: GainNode;
  output: GainNode;
}

/**
 * Converts a linear magnitude value to decibels for biquad filter gain` parameters.
 *
 * The Web Audio API's biquad filters use a Q parameter that is logarithmic in nature.
 * This function converts a linear magnitude (e.g., 0.7071 for Butterworth Q value)
 * to the corresponding dB value.
 * @param mag The linear magnitude value to convert (e.g., 0.7071).
 * @returns The corresponding magnitude value in decibels for use in biquad filters.
 */
export function magnitudeToDb(mag: number): number {
  return 20 * Math.log10(mag);
}

/**
 * Implements bandpass filtering and mu-law compression to emulate
 * the frequency response of a telephone line.
 */
export class TelephoneLineFilter implements AudioFilter {
  public input: GainNode;
  public output: GainNode;

  constructor(ctx: BaseAudioContext) {
    // Web audio biquads expect Q values in dB for LP and HP filters
    const q1 = magnitudeToDb(0.541196); // 1st Butterworth stage
    const q2 = magnitudeToDb(1.306563); // 2nd Butterworth stage
    const hpCutoff = 400;
    const lpCutoff = 3400;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // 4th-order Highpass
    const hp1 = ctx.createBiquadFilter();
    hp1.type = "highpass";
    hp1.frequency.value = hpCutoff;
    hp1.Q.value = q1;
    this.input.connect(hp1);
    const hp2 = ctx.createBiquadFilter();
    hp2.type = "highpass";
    hp2.frequency.value = hpCutoff;
    hp2.Q.value = q2;
    hp1.connect(hp2);

    // 4th-order Lowpass
    const lp1 = ctx.createBiquadFilter();
    lp1.type = "lowpass";
    lp1.frequency.value = lpCutoff;
    lp1.Q.value = q1;
    hp2.connect(lp1);
    const lp2 = ctx.createBiquadFilter();
    lp2.type = "lowpass";
    lp2.frequency.value = lpCutoff;
    lp2.Q.value = q2;
    lp1.connect(lp2);

    const muLawShaper = ctx.createWaveShaper();
    muLawShaper.curve = this.makeMuLawCurve();
    // smooth the curve to reduce aliasing artifacts
    muLawShaper.oversample = "4x";

    lp2.connect(muLawShaper);
    muLawShaper.connect(this.output);
  }

  /**
   * Generates a Float32Array representing the Mu-law compression curve from -1.0 to 1.0.
   * @param mu Standard telecommunication mu value is 255.
   * @param resolution Number of points in the curve.
   * @returns A Float32Array containing the Mu-law curve values.
   */
  private makeMuLawCurve(
    mu: number = 255,
    resolution: number = 4096,
  ): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(resolution);
    // Precompute constant value
    const denominator = Math.log(1 + mu);

    for (let i = 0; i < resolution; i++) {
      const x = (i * 2) / (resolution - 1) - 1;
      // Mu-law compression algorithm
      curve[i] = Math.sign(x) * (Math.log(1 + mu * Math.abs(x)) / denominator);
    }
    return curve;
  }
}

/**
 * Speaker Emulation Filter.
 * Cuts bass aggressively below 50Hz, creates a sharp acoustic resonance peak at 1.5kHz,
 * and rolls off high-frequency digital harshness over 5kHz.
 */
export class SpeakerFilter implements AudioFilter {
  public input: GainNode;
  public output: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Aggressive low-end roll-off
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 100;
    hp.Q.value = magnitudeToDb(0.7071);
    this.input.connect(hp);
    const hp2 = ctx.createBiquadFilter();
    hp2.type = "highpass";
    hp2.frequency.value = 800;
    hp2.Q.value = magnitudeToDb(0.75);
    hp.connect(hp2);

    // Midrange resonant peak
    const peaking = ctx.createBiquadFilter();
    peaking.type = "peaking";
    peaking.frequency.value = 1500;
    peaking.Q.value = magnitudeToDb(1.3);
    peaking.gain.value = 4;
    hp2.connect(peaking);

    // More gentle high-frequency roll-off
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 10000;
    lp.Q.value = magnitudeToDb(0.7071);
    peaking.connect(lp);
    lp.connect(this.output);
  }
}

/**
 * Analytical Wave-Shaper for Soft Saturation (THD / Clipping).
 */
export class SoftSaturationShaper implements AudioFilter {
  public input: GainNode;
  public output: GainNode;
  private driveGain: GainNode;
  private normGain: GainNode;
  private shaper: WaveShaperNode;

  // Higher value equals more distortion/rounding
  constructor(ctx: BaseAudioContext, drive: number) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.driveGain = ctx.createGain();
    this.normGain = ctx.createGain();

    this.shaper = ctx.createWaveShaper();

    this.input.connect(this.driveGain);
    this.driveGain.connect(this.shaper);
    this.shaper.connect(this.normGain);
    this.normGain.connect(this.output);

    this.updateDrive(ctx, drive);
  }

  /**
   * Updates the drive curve and balances the internal volume stages.
   * @param ctx The audio context to use for timing.
   * @param drive The drive amount (0.01 to 1.0). Higher values are more distorted.
   */
  public updateDrive(ctx: BaseAudioContext, drive: number): void {
    // Prevent divide-by-zero errors if drive is exactly 0
    drive = drive ? drive : 0.01;

    const samples = 4096;
    const curve = new Float32Array(samples);
    const denominator = Math.tanh(drive);

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / denominator;
    }
    this.shaper.curve = curve;
    this.shaper.oversample = "2x";

    // Apply drive and normalize output level
    this.driveGain.gain.setValueAtTime(drive, ctx.currentTime);
    this.normGain.gain.setValueAtTime(1 / drive, ctx.currentTime);
  }
}

export class FullModemFilter implements AudioFilter {
  public input: GainNode;
  public output: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.gain.value = 1.0;
    this.output.gain.value = 1.0;

    const speakerFilter = new SpeakerFilter(ctx);
    const phoneFilter = new TelephoneLineFilter(ctx);
    //const saturationFilter = new SoftSaturationShaper(ctx, 0.75);

    //this.input.connect(saturationFilter.input);
    //saturationFilter.output.connect(phoneFilter.input);
    this.input.connect(phoneFilter.input);
    phoneFilter.output.connect(speakerFilter.input);
    speakerFilter.output.connect(this.output);
  }
}

export class FrequencyShaper {
  public input: GainNode;
  public output: GainNode;

  private context: BaseAudioContext;
  private filters: BiquadFilterNode[] = [];

  constructor(context: BaseAudioContext) {
    this.context = context;

    // We use dummy GainNodes at the ends to enable pipelining nodes.
    this.input = this.context.createGain();
    this.output = this.context.createGain();

    // Default state: bypass (input goes straight to output)
    this.input.connect(this.output);
  }

  /**
   * Applies the EQ curve to the audio stream.
   * @param eqValues Array of numbers from -1 (cut) to 1 (boost).
   * @param minFreq The lowest frequency in the range (e.g., 20 Hz).
   * @param maxFreq The highest frequency in the range (e.g., 20000 Hz).
   * @param maxDb The maximum boost/cut in decibels (defaults to 12dB).
   */
  public setCurve(
    eqValues: number[],
    minFreq: number,
    maxFreq: number,
    maxDb: number = 12,
  ): void {
    const numBands = eqValues.length;
    if (numBands === 0) return;

    // Disconnect existing filters and clear the array
    this.input.disconnect();
    this.filters.forEach((filter) => filter.disconnect());
    this.filters = [];

    // calculate multiplicative ratio for geometric spacing of frequencies
    const ratio = Math.pow(maxFreq / minFreq, 1 / Math.max(1, numBands - 1));

    // Calculate the Q factor (resonance/width) so the bands blend smoothly
    // Q = sqrt(ratio) / (ratio - 1)
    const qValue = numBands > 1 ? Math.sqrt(ratio) / (ratio - 1) : 1;

    // 3. Build the filter chain
    let previousNode: AudioNode = this.input;

    for (let i = 0; i < numBands; i++) {
      const filter = this.context.createBiquadFilter();

      // Determine filter type (shelves for the edges, peaking for the middle)
      if (i === 0) {
        filter.type = "lowshelf";
      } else if (i === numBands - 1) {
        filter.type = "highshelf";
      } else {
        filter.type = "peaking";
        filter.Q.value = qValue;
      }

      // Calculate center frequency for this band
      const freq = minFreq * Math.pow(ratio, i);
      filter.frequency.value = Math.min(freq, this.context.sampleRate / 2);

      // Map the -1 to 1 input to -maxDb to +maxDb
      const normalizedVal = Math.max(-1, Math.min(1, eqValues[i]!));
      filter.gain.value = normalizedVal * maxDb;

      // Connect the chain: previous -> filter
      previousNode.connect(filter);
      previousNode = filter;

      this.filters.push(filter);
    }

    // Connect the final filter to the output
    previousNode.connect(this.output);
  }

  /**
   * Clears the EQ and returns to a flat passthrough.
   */
  public bypass(): void {
    this.input.disconnect();
    this.filters.forEach((filter) => filter.disconnect());
    this.filters = [];
    this.input.connect(this.output);
  }
}
