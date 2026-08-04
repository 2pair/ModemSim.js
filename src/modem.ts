/*
 *   It's a real life modem, Michael!
 */

import { TelephoneLineFilter, SpeakerFilter } from "./filters";
import {
  type Frequency,
  type TimeSec,
  type Bit,
  encodeFSK,
  encodeDPSK,
  encodeQAM16,
} from "./encodings";

type LoggerLike = {
  log(message: string, time?: TimeSec): void;
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
 * Implements the V.34 LFSR scrambler to generate a pseudo-random bit sequence.
 *
 * @param length The number of bits to generate
 * @return An array of bits representing the scrambler output
 */
function v34LfsrScrambler(length: number): Bit[] {
  const bits: Bit[] = [];
  const bitmask = Math.pow(2, 23) - 1;
  // This is a bit of a joke
  let state = Math.random() * bitmask;
  for (let i = 0; i < length; i++) {
    // output bit is xor of 1, bit 18, and bit 23 of the current state
    const newBit = ((1 ^ (state >> 17) ^ (state >> 22)) & 1) as Bit;
    bits.push(newBit);
    state = ((state << 1) | newBit) & bitmask;
  }
  return bits;
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
  ctx: BaseAudioContext,
  outputNode: AudioNode,
  freqs: readonly Frequency[],
  startTime: TimeSec,
  duration: TimeSec,
  amplitude: number = 0.3,
  invertPhase: boolean = false,
): void {
  const gain = ctx.createGain();
  // Maintain perceptual loudness by normalizing gain based on number of tones
  const normalizedAmplitude = amplitude / Math.sqrt(freqs.length);
  const phase = invertPhase ? -1 : 1;
  gain.gain.setValueAtTime(amplitude * normalizedAmplitude * phase, startTime);

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
 * Plays the 2100Hz ANSam tone with phase flips every ~450ms to signal the modem to switch to data mode.
 *
 * @param ctx - The AudioContext to use
 * @param outputNode - The audio node to connect to
 * @param startTime - Start time in seconds
 * @param duration - Duration in seconds
 * @returns The end time of the played tone
 */
function playAnsam(
  ctx: BaseAudioContext,
  outputNode: AudioNode,
  startTime: TimeSec,
  duration: TimeSec = 2.975,
): TimeSec {
  const carrierOsc = ctx.createOscillator();
  carrierOsc.frequency.value = 2100;
  const carrierGain = ctx.createGain();
  carrierGain.gain.value = 0.45;

  const amOsc = ctx.createOscillator();
  amOsc.frequency.value = 15;
  const amModGain = ctx.createGain();
  amModGain.gain.value = 0.2 * carrierGain.gain.value;

  amOsc.connect(amModGain);
  amModGain.connect(carrierGain);
  carrierOsc.connect(carrierGain);
  const phaseInvert = ctx.createGain();
  let polarity = 1;
  const ansamShiftRate = 0.425;
  for (let offset = 0; offset < duration; offset += ansamShiftRate) {
    phaseInvert.gain.setValueAtTime(polarity, startTime + offset);
    polarity *= -1;
  }
  carrierGain.connect(phaseInvert).connect(outputNode);
  carrierOsc.start(startTime);
  amOsc.start(startTime);
  carrierOsc.stop(startTime + duration);
  amOsc.stop(startTime + duration);

  return startTime + duration;
}

/** * Builds the complete modem dialup handshake.
 *
 * @param ctx - The AudioContext to use for tone generation
 * @param outputNode - The audio node to connect the modem output to
 * @param logger - Logger for connection progress updates
 * @returns The total duration of the dialup sequence in seconds
 */
function buildModemHandhsake(
  ctx: BaseAudioContext,
  outputNode: GainNode,
  logger: LoggerLike,
): TimeSec {
  let t = ctx.currentTime + 0.1;
  // Dial tone
  playTones(ctx, outputNode, [350, 440], t, 1.73);
  t += 1.5;
  // Dialing
  logger.log("Dialing...", t);
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
  logger.log("Initiating V.8 bis transaction...", t);
  // (V8bISeg) Caller initializes request
  playTones(ctx, outputNode, [1375, 2002], t, 0.4, 0.2);
  t += 0.395;
  // (CReSeg) Caller sends capabilities request
  playTones(ctx, outputNode, [400], t, 0.1, 0.4);
  t += 0.25; // signal len + propagation delay
  // (V8bRSeg) Answerer responds to capabilities request
  playTones(ctx, outputNode, [1529, 2225], t, 0.4, 0.4);
  t += 0.395;
  // (CRdSeg) Answerer lists capabilities
  playTones(ctx, outputNode, [1900], t, 0.1, 0.12);
  t += 0.15; // signal len + propagation delay
  // (ESrSeg) Caller sends escape signal
  playTones(ctx, outputNode, [1650], t, 0.1, 0.03);
  t += 0.175; // signal len + propagation delay

  logger.log("Capabilities advertisement...", t);
  // (CL) Capabilities list
  t = encodeFSK(
    ctx,
    outputNode,
    stringToBits("HEY I WANNA GET ONLINE"),
    1180,
    980,
    t,
    1,
  );
  t += 0.15;
  // (MS) Mode selection
  logger.log("Selecting V.90 mode...", t);
  t = encodeFSK(
    ctx,
    outputNode,
    stringToBits("YEA SURE LETS GET ONLINE"),
    1850,
    1650,
    t,
    1,
  );
  // (ACK) ends V.8 bis transaction
  t = encodeFSK(ctx, outputNode, stringToBits("LETS GO"), 1180, 980, t, 1);
  t += 0.88; // Guard time before echo cancellation starts

  // ANSam
  logger.log("DETECTING ANSam...", t);
  t = playAnsam(ctx, outputNode, t, 3.14159);

  logger.log("V.8 MENU NEGOTIATION...", t);
  // (CM) Client sends menu
  // 9 bytes == 72 bits, @300 baud == 0.24s signal length + preamble ~0.25 s
  // Ansam should stop after min 2  CM + 100ms
  const tCmStart = t - 0.6;
  const tCmEnd = encodeFSK(
    ctx,
    outputNode,
    stringToBits("COMPUTER!"),
    1180,
    980,
    tCmStart,
    6,
    0.025,
  );
  // (JM) Server responds with joint menu 0.075s after Ansam ends
  const tJmStart = t + 0.075;
  const tJmEnd = encodeFSK(
    ctx,
    outputNode,
    stringToBits("UGH DATA!"),
    1850,
    1650,
    tJmStart,
    3,
    0.025,
  );
  const tAckStart = tJmEnd - 0.25;
  const tAckEnd = encodeFSK(
    ctx,
    outputNode,
    stringToBits("SRV_ACK"),
    1190,
    980,
    tAckStart,
    2,
    0.025,
  );
  // add quiet time before next stage
  t = Math.max(tCmEnd, tJmEnd, tAckEnd) + 0.75;

  logger.log("BEGIN LINE PROBE AND RANGING...", t);
  const phaseStart = t;
  const rangingTime = 0.35;
  const rangingEnd = phaseStart + rangingTime;

  playTones(ctx, outputNode, [1800], phaseStart, rangingTime);
  const callProbeEnd = encodeDPSK(
    ctx,
    outputNode,
    stringToBits("PROBING!"),
    1200,
    phaseStart,
  );
  playTones(ctx, outputNode, [1200], callProbeEnd, rangingEnd - callProbeEnd);
  const answerProbeEnd = encodeDPSK(
    ctx,
    outputNode,
    stringToBits("PROBED!!"),
    2400,
    phaseStart + 0.05,
  );
  playTones(
    ctx,
    outputNode,
    [2400],
    answerProbeEnd,
    rangingEnd - answerProbeEnd,
  );

  t = rangingEnd;

  const broadProbeFreqs = Array.from(
    { length: 21 },
    (_, index) => 150 + index * 150,
  );
  // TODO: Work on the timing here
  // L1 probe
  playTones(ctx, outputNode, broadProbeFreqs, t, 0.35, 0.75, true);
  t += 0.35;
  playTones(ctx, outputNode, [1200, 1800], t - 0.05, 0.1, 0.3, true);
  //playTones(ctx, outputNode, [1200, 2400], t, 0.8, 0.3, true);
  playTones(ctx, outputNode, [1800, 2400], t - 0.05, 0.15);
  t += 0.08;
  // L2 probe
  playTones(ctx, outputNode, broadProbeFreqs, t, 0.35, 0.75, true);
  t += 0.35;
  playTones(ctx, outputNode, [2400], t - 0.1, 0.3);
  playTones(ctx, outputNode, [1800], t - 0.1, 0.45);
  //playTones(ctx, outputNode, [2400], t, 0.1);
  //playTones(ctx, outputNode, [1800], t, 0.2);

  t = encodeDPSK(ctx, outputNode, stringToBits("WOW NICE PROBES"), 1200, t);
  t = encodeDPSK(ctx, outputNode, stringToBits("GOOD PROBES"), 2400, t);
  t += 0.05;

  // --- SEQUENTIAL QAM TRAINING ---
  logger.log("V.90 TRAINING: CLIENT...", t);
  let duration = 0.16;
  let symbolRate = 2400;
  encodeQAM16(
    ctx,
    outputNode,
    v34LfsrScrambler(symbolRate * duration * 4), // 4 bits per symbol for QAM16
    1600,
    t,
    5,
    1,
    3,
    600,
  );
  t += duration + 0.1;
  logger.log("V.90 TRAINING: SERVER...", t);
  duration = 0.16;
  encodeQAM16(
    ctx,
    outputNode,
    v34LfsrScrambler(symbolRate * duration), // 600 baud for 0.16s == 96 bits
    1800,
    t,
    5,
    1,
    3,
    2400,
  );
  t += duration + 0.1;
  encodeQAM16(
    ctx,
    outputNode,
    v34LfsrScrambler(symbolRate * duration), // 600 baud for 0.16s == 96 bits
    1800,
    t,
    5,
    1,
    3,
    3000,
  );
  logger.log("TRAINING COMPLETE. CONNECTED!", t);
  return t;
}

export type DialupPipeline = {
  input: GainNode;
  output: GainNode;
  completion: Promise<void>;
};

function createPhoneAudioPipeline(ctx: OfflineAudioContext): {
  input: GainNode;
  output: GainNode;
} {
  const inputNode = ctx.createGain();
  const outputNode = ctx.createGain();
  const phoneFilter = new TelephoneLineFilter(ctx);

  inputNode.connect(phoneFilter.input);
  phoneFilter.output.connect(outputNode);
  outputNode.connect(ctx.destination);

  return { input: inputNode, output: outputNode };
}

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
  const log = (msg: string, time?: TimeSec) => logger.log(msg, time);
  log("CONNECTION START...", ctx.currentTime);

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.6;
  masterGain.connect(ctx.destination);

  const phoneSampleRate = 8000;
  const phoneCtx = new OfflineAudioContext(
    1,
    phoneSampleRate * 20,
    phoneSampleRate,
  );
  const phonePipeline = createPhoneAudioPipeline(phoneCtx);

  const completion = (async () => {
    const completionTime = buildModemHandhsake(
      phoneCtx,
      phonePipeline.input,
      logger,
    );

    let renderedBuffer: AudioBuffer | undefined;
    renderedBuffer = await phoneCtx.startRendering();

    const actualLength = Math.min(
      renderedBuffer.length,
      Math.floor(completionTime * renderedBuffer.sampleRate),
    );
    // The phone audio pipeline is mono
    const playbackBuffer = ctx.createBuffer(
      1,
      actualLength,
      renderedBuffer.sampleRate,
    );
    playbackBuffer.copyToChannel(
      renderedBuffer.getChannelData(0).subarray(0, actualLength),
      0,
    );

    const playbackSource = ctx.createBufferSource();
    playbackSource.buffer = playbackBuffer;

    const speakerFilter = new SpeakerFilter(ctx);
    playbackSource.connect(speakerFilter.input);
    speakerFilter.output.connect(masterGain);

    playbackSource.start(ctx.currentTime);
    await new Promise<void>((resolve) => {
      playbackSource.onended = () => resolve();
    });

    log("<b>CONNECT V.90</b>", completionTime);
  })();

  return {
    input: phonePipeline.input,
    output: phonePipeline.output,
    completion,
  };
}

export { initiateDialup };
