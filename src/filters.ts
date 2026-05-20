export interface AudioFilter {
  input: GainNode;
  output: GainNode;
}

/**
 * 4th-Order Butterworth Bandpass Filter.
 */
export class TelephoneLineFilter implements AudioFilter {
  public input: GainNode;
  public output: GainNode;

  constructor(ctx: AudioContext) {
    const q1 = 0.541196; // Q for 1st stage of Butterworth
    const q2 = 1.306563; // Q for 2nd stage of Butterworth
    //const hpCutoff = 400;
    const lpCutoff = 3400;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // 4th-order Highpass
    /*const hp1 = ctx.createBiquadFilter();
    hp1.type = "highpass";
    hp1.frequency.value = hpCutoff;
    hp1.Q.value = q1;
    this.input.connect(hp1);
    const hp2 = ctx.createBiquadFilter();
    hp2.type = "highpass";
    hp2.frequency.value = hpCutoff;
    hp2.Q.value = q2;
    hp1.connect(hp2);
    */
    // 4th-order Lowpass
    const lp1 = ctx.createBiquadFilter();
    lp1.type = "lowpass";
    lp1.frequency.value = lpCutoff;
    lp1.Q.value = q1;
    this.input.connect(lp1);
    //hp2.connect(lp1);
    const lp2 = ctx.createBiquadFilter();
    lp2.type = "lowpass";
    lp2.frequency.value = lpCutoff;
    lp2.Q.value = q2;
    lp1.connect(lp2);
    lp2.connect(this.output);
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

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    // Aggressive low-end acoustic roll-off
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 50;
    hp.Q.value = 0.7071;
    this.input.connect(hp);

    // Sharp midrange resonant peak
    const peaking = ctx.createBiquadFilter();
    peaking.type = "peaking";
    peaking.frequency.value = 1500;
    peaking.Q.value = 1.5;
    peaking.gain.value = 4;
    hp.connect(peaking);

    // High-frequency acoustic smoothing
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5000;
    lp.Q.value = 0.7071;
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
  constructor(ctx: AudioContext, drive: number) {
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
   */
  public updateDrive(ctx: AudioContext, drive: number): void {
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

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.gain.value = 1.0;
    this.output.gain.value = 1.0;

    const speakerFilter = new SpeakerFilter(ctx);
    const phoneFilter = new TelephoneLineFilter(ctx);
    const saturationFilter = new SoftSaturationShaper(ctx, 1.5);

    this.input.connect(saturationFilter.input);
    saturationFilter.output.connect(phoneFilter.input);
    phoneFilter.output.connect(speakerFilter.input);
    speakerFilter.output.connect(this.output);
  }
}
