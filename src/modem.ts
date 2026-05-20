/*
 *   It's a real life modem, Michael!
 */

import { FullModemFilter } from "./filters";

/** Audio frequency measured in Hertz (Hz). */
type Frequency = number;
/** Time duration or timestamp measured in seconds. */
type TimeSec = number;
/** Symbol rate measured in symbols per second (Baud). */
type BaudRate = number;
/** All the numbers in the universe. */
type Bit = 0 | 1;

type LoggerLike = {
  log(message: string): void;
};

/** DTMF map for touch-tone dialing */
const dtmfMap: Record<string, readonly [Frequency, Frequency]> = {
  "0": [941, 1336],
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "#": [941, 1477],
};

/** Converts a string into an array of bits (LSB first). */
function stringToBits(str: string): Bit[] {
  const encoder = new TextEncoder();
  const view = encoder.encode(str);
  const bits: Bit[] = [];

  for (const byte of view) {
    for (let b = 0; b < 8; b++) {
      bits.push(((byte >> b) & 1) as Bit);
    }
  }
  return bits;
}

/**
 * Encodes data bits as FSK modulation.
 *
 * @param ctx - The AudioContext to use for oscillator creation
 * @param outputNode - The audio node to connect the oscillator to
 * @param dataBits - Array of bits to encode (LSB first)
 * @param spaceFreq - Frequency (Hz) to use for bit value 0
 * @param markFreq - Frequency (Hz) to use for bit value 1
 * @param startTime - Start time in seconds
 * @param repeats - Number of times to repeat the data sequence
 * @param preamble - Length of time in seconds to play the mark tone before message
 * @param preFlags - Number of flag octets to prepend
 * @param postFlags - Number of flag octets to append
 * @param flagOctet - Bit pattern to use for flag octets
 * @param baudRate - Symbol rate in Baud (bits per second)
 * @returns The stop time of the oscillator
 */
function encodeFSK(
  ctx: AudioContext,
  outputNode: AudioNode,
  dataBits: Bit[],
  spaceFreq: Frequency,
  markFreq: Frequency,
  startTime: TimeSec,
  repeats: number = 1,
  preamble: TimeSec = 0.1,
  preFlags: number = 3,
  postFlags: number = 2,
  flagOctet: Bit[] = [0, 1, 1, 1, 1, 1, 1, 0],
  baudRate: BaudRate = 300,
): number {
  const preambleMarkLength = Math.ceil(preamble * baudRate);
  const preambleFlagsLength = preFlags * flagOctet.length;
  const preambleLength = preambleMarkLength + preambleFlagsLength;
  const postambleLength = postFlags * flagOctet.length;
  const dataLength = dataBits.length * repeats;
  const totalFrameLength = preambleLength + dataLength + postambleLength;
  if (totalFrameLength === 0) {
    return startTime;
  }

  const bitStream: Bit[] = new Array(totalFrameLength * repeats);
  for (let r = 0; r < repeats; r++) {
    bitStream.push(...new Array(preambleMarkLength).fill(1));
    for (let i = 0; i < preFlags; i++) {
      bitStream.push(...flagOctet);
    }
    bitStream.push(...dataBits);
    for (let i = 0; i < postFlags; i++) {
      bitStream.push(...flagOctet);
    }
  }

  const osc = ctx.createOscillator();
  osc.type = "sine";
  // Set default frequency to the first bit's frequency to avoid initial clicks
  osc.frequency.value = bitStream[0] === 1 ? markFreq : spaceFreq;
  const bitDuration = 1 / baudRate;
  let currentTime = startTime;

  for (const bit of bitStream) {
    const freq = bit === 1 ? markFreq : spaceFreq;
    osc.frequency.setValueAtTime(freq, currentTime);
    currentTime += bitDuration;
  }

  osc.connect(outputNode);
  osc.start(startTime);
  osc.stop(currentTime);

  return currentTime;
}

/**
 * Plays n sine wave tones simultaneously (DTMF-style tones, etc).
 *
 * @param ctx - The AudioContext to use
 * @param outputNode - The audio node to connect to
 * @param freqs - Array of frequencies (Hz)
 * @param startTime - Start time in seconds
 * @param duration - Duration in seconds
 * @param amplitude - Amplitude of combined signal (0.0 to 1.0)
 * @param invertPhase - If true, inverts the phase of the tones
 */
function playTones(
  ctx: AudioContext,
  outputNode: AudioNode,
  freqs: readonly Frequency[],
  startTime: TimeSec,
  duration: TimeSec,
  amplitude: number = 0.3,
  invertPhase: boolean = false,
): void {
  const gain = ctx.createGain();
  gain.gain.value = amplitude / freqs.length;
  if (invertPhase) {
    gain.gain.value = -gain.gain.value;
  }
  freqs.forEach((freq) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(startTime);
    osc.stop(startTime + duration);
  });
  gain.connect(outputNode);
}

/**
 * Plays a complex probe pulse using harmonic series.
 * Used for V.34 line probing to characterize the line characteristics.
 * Due to the complex envelope, the pulse time is  0.7s and not configurable.
 *
 * @param ctx - The AudioContext to use
 * @param outputNode - The audio node to connect to
 * @param time - Start time in seconds
 */
function playProbePulse(
  ctx: AudioContext,
  outputNode: AudioNode,
  time: TimeSec,
): void {
  const pulseGain = ctx.createGain();

  pulseGain.gain.setValueAtTime(0, time);
  // Overshoot
  pulseGain.gain.linearRampToValueAtTime(0.1, time + 0.001);
  // Settle
  //pulseGain.gain.exponentialRampToValueAtTime(0.1, time + 0.07);
  // Sustain
  pulseGain.gain.setValueAtTime(0.1, time + 0.1);
  // Long tail
  pulseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.7);

  for (let i = 1; i <= 21; i++) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = i * 166;

    const real = new Float32Array(2);
    const imag = new Float32Array(2);
    // Desynced harmonics with random phase to create a more complex probe signal
    const phase = Math.random() * Math.PI * 2;
    real[1] = Math.cos(phase);
    imag[1] = Math.sin(phase);
    const wave = ctx.createPeriodicWave(real, imag);
    osc.setPeriodicWave(wave);

    osc.connect(pulseGain);
    osc.start(time);
    osc.stop(time + 0.8);
  }
  pulseGain.connect(outputNode);
}

/** * Builds the complete modem dialup pipeline with tones, FSK sequences, and probes.
 *
 * @param ctx - The AudioContext to use for tone generation
 * @param outputNode - The audio node to connect the modem output to
 * @param logger - Logger for connection progress updates
 * @returns The total duration of the dialup sequence in seconds
 */
function buildModemPipeline(
  ctx: AudioContext,
  outputNode: GainNode,
  logger: LoggerLike,
): TimeSec {
  let t = ctx.currentTime + 0.1;

  // Dial tone
  playTones(ctx, outputNode, [350, 440], t, 1.73);
  t += 1.5;
  // Dialing
  logger.log("Dialing...");
  "18005551234".split("").forEach((d) => {
    const freqs = dtmfMap[d];
    if (!freqs) return;

    playTones(ctx, outputNode, freqs, t, 0.12);
    t += 0.19;
  });
  t += 0.5;
  //Ringing
  playTones(ctx, outputNode, [440, 480], t, 1.5);
  t += 2.0;

  // Request V.8 bis negotiation
  logger.log("Initiating V.8 bis transaction...");
  playTones(ctx, outputNode, [1375, 2002], t, 0.4, 0.2);
  t += 0.3;
  // (CRe) List capabilities request
  playTones(ctx, outputNode, [400], t, 0.1, 0.4);
  t += 0.1;
  // Caller response and agreement to negotiate
  playTones(ctx, outputNode, [1529, 2225], t, 0.4, 0.4);
  t += 0.35;
  // (CRd) Agreement to list capabilities
  playTones(ctx, outputNode, [1900], t, 0.1, 0.12);
  t += 0.15;
  // (ES) escape to information transfer mode
  playTones(ctx, outputNode, [1650], t, 0.1, 0.03);
  t += 0.02;

  logger.log("Capabilities advertisement...");
  // (CL) Capabilities list
  t = encodeFSK(
    ctx,
    outputNode,
    stringToBits("HEY I WANNA GET ONLINE"),
    1000,
    1200,
    t,
    1,
  );
  t += 0.15;
  // (MS) Mode selection
  logger.log("Selecting V.90 mode...");
  t = encodeFSK(
    ctx,
    outputNode,
    stringToBits("YEA SURE LETS GET ONLINE"),
    1650,
    1900,
    t,
    1,
  );
  // (ACK) ends V.8 bis transaction
  t = encodeFSK(ctx, outputNode, stringToBits("LETS GO"), 1000, 1200, t, 1);
  t += 0.88;

  // ANSam
  logger.log("DETECTING ANSam (2100Hz + PHASE FLIPS)...");
  const ansOsc = ctx.createOscillator();
  ansOsc.frequency.value = 2100;
  const amOsc = ctx.createOscillator();
  amOsc.frequency.value = 15;
  const amGain = ctx.createGain();
  amGain.gain.value = 0.4;
  const amMod = ctx.createGain();
  amMod.gain.value = 0.45;
  amOsc.connect(amMod).connect(amGain.gain);
  ansOsc.connect(amGain);
  const phaseInvert = ctx.createGain();
  let polarity = 1;
  for (let offset = 0; offset < 3.3; offset += 0.45) {
    phaseInvert.gain.setValueAtTime(polarity, t + offset);
    polarity *= -1;
  }
  amGain.connect(phaseInvert).connect(outputNode);
  ansOsc.start(t);
  amOsc.start(t);
  ansOsc.stop(t + 3.3);
  amOsc.stop(t + 3.3);

  // --- OVERLAPPING FSK ---
  let t_fsk = t + 2.8;
  logger.log("V.8 MENU NEGOTIATION (FSK REPEATS)...");
  let t_srv1 = encodeFSK(
    ctx,
    outputNode,
    stringToBits("COMPUTER!"),
    1750,
    1650,
    t_fsk,
    6,
    0.025,
  );
  let t_cli = encodeFSK(
    ctx,
    outputNode,
    stringToBits("UGH DATA!"),
    1080,
    980,
    t_fsk + 0.35,
    3,
    0.025,
  );
  let t_srv2 = encodeFSK(
    ctx,
    outputNode,
    stringToBits("SRV_ACK"),
    1750,
    1650,
    t_cli - 0.2,
    2,
    0.025,
  );
  t = Math.max(t_srv1, t_cli, t_srv2) + 0.2;

  // --- BONG BONG PROBES ---
  logger.log("V.34 LINE PROBING (CLIENT -> SERVER)...");
  const probeCarriers = [1200, 1850, 2500] as const;

  // Initial carrier tone before the probe starts.
  playTones(ctx, outputNode, probeCarriers, t, 0.05);

  // Start the first probe set with a 180° phase-inverted carrier tone.
  const firstProbeStart = t + 0.05;
  playTones(ctx, outputNode, probeCarriers, firstProbeStart, 0.05, 0.2, true);
  playProbePulse(ctx, outputNode, firstProbeStart);
  playProbePulse(ctx, outputNode, firstProbeStart + 0.2);

  // Short carrier burst between the first and second probe pairs.
  const interProbeToneStart = firstProbeStart + 0.8;
  playTones(ctx, outputNode, probeCarriers, interProbeToneStart, 0.05);

  t += 0.9;
  playProbePulse(ctx, outputNode, t);
  playProbePulse(ctx, outputNode, t + 0.2);

  const finalCarrierStart = t + 1.0;
  playTones(ctx, outputNode, probeCarriers, finalCarrierStart, 0.25);

  // Overlap the final carrier series with the next content.
  t = finalCarrierStart + 0.05;

  // --- SEQUENTIAL QAM TRAINING ---
  logger.log("V.90 TRAINING: CLIENT (3800Hz LP)...");
  const qamDur = 3.0;
  const noiseBuf = ctx.createBuffer(
    1,
    ctx.sampleRate * qamDur * 2,
    ctx.sampleRate,
  );
  const pcmData = noiseBuf.getChannelData(0);
  for (let i = 0; i < pcmData.length; i++) {
    pcmData[i] = Math.random() * 2 - 1;
  }

  const eqBody = ctx.createBiquadFilter();
  eqBody.type = "lowshelf";
  eqBody.frequency.value = 800;
  eqBody.gain.value = 3;
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = 1500;
  eqMid.Q.value = 1;
  eqMid.gain.value = 4;
  eqBody.connect(eqMid);

  // CLIENT SESSION
  const cliNoise = ctx.createBufferSource();
  cliNoise.buffer = noiseBuf;
  const cliLpf = ctx.createBiquadFilter();
  cliLpf.type = "lowpass";
  cliLpf.frequency.value = 3800;
  const cliGain = ctx.createGain();
  cliGain.gain.setValueAtTime(0, t);
  cliGain.gain.linearRampToValueAtTime(0.25, t + 0.1);
  cliGain.gain.setValueAtTime(0.25, t + qamDur - 0.1);
  cliGain.gain.linearRampToValueAtTime(0, t + qamDur);

  cliNoise.connect(eqBody);
  eqMid.connect(cliLpf);
  cliLpf.connect(cliGain).connect(outputNode);
  cliNoise.start(t);
  t += qamDur + 0.1;

  // SERVER SESSION
  logger.log("V.90 TRAINING: SERVER (4200Hz LP)...");
  const srvNoise = ctx.createBufferSource();
  srvNoise.buffer = noiseBuf;
  const srvLpf = ctx.createBiquadFilter();
  srvLpf.type = "lowpass";
  srvLpf.frequency.value = 4200;
  const srvGain = ctx.createGain();
  srvGain.gain.setValueAtTime(0, t);
  srvGain.gain.linearRampToValueAtTime(0.25, t + 0.1);
  srvGain.gain.setValueAtTime(0.25, t + qamDur - 0.1);
  srvGain.gain.linearRampToValueAtTime(0, t + qamDur);

  srvNoise.connect(eqBody);
  eqMid.connect(srvLpf);
  srvLpf.connect(srvGain).connect(outputNode);
  srvNoise.start(t);
  t += qamDur;

  logger.log("TRAINING COMPLETE. CONNECTED!");
  return t;
}

export type DialupPipeline = {
  input: GainNode;
  output: GainNode;
  completion: Promise<void>;
};

/**
 * Initiates a complete V.90 modem handshake sequence.
 *
 * Simulates the full modem dialup experience including:
 * - Dial tone and DTMF dialing
 * - Ringing tones
 * - ANSam detection (2100Hz answer tone with phase flips)
 * - FSK V.8 menu negotiation
 * - Transition to wideband
 * - V.34 line probing with complex probe pulses
 * - V.90 training sequences for both client and server
 *
 * Re-enables the connect button when complete.
 *
 * @param ctx - The AudioContext to use for tone generation
 * @param logger - Optional logger for connection progress
 */
function initiateDialup(
  ctx: AudioContext,
  logger: LoggerLike = { log: () => {} },
): DialupPipeline {
  const log = (msg: string) => logger.log(msg);
  log("CONNECTION START...");

  const inputNode = ctx.createGain();
  const outputNode = ctx.createGain();
  inputNode.gain.value = 1.0;
  outputNode.gain.value = 1.0;

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.6;
  masterGain.connect(ctx.destination);

  const modemFilter = new FullModemFilter(ctx);

  inputNode.connect(modemFilter.input);
  modemFilter.output.connect(outputNode);
  outputNode.connect(masterGain);

  const completion = new Promise<void>((resolve) => {
    const t = buildModemPipeline(ctx, inputNode, logger);
    setTimeout(
      () => {
        log("<b>CONNECT 56000 / V.90</b>");
        resolve();
      },
      (t - ctx.currentTime) * 1000,
    );
  });

  return { input: inputNode, output: outputNode, completion };
}

export { initiateDialup };
