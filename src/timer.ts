export class ModemTimer {
  private startTime: number = 0;
  private running: boolean = false;
  private animationFrameId: number = 0;

  constructor(private displayElement: HTMLElement) {}

  public start() {
    this.startTime = performance.now();
    this.running = true;
    this.update();
  }

  public stop() {
    this.running = false;
    cancelAnimationFrame(this.animationFrameId);
  }

  public reset() {
    this.stop();
    this.displayElement.innerText = "00:00.00";
  }

  private update = () => {
    if (!this.running) return;

    const elapsed = performance.now() - this.startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const milliseconds = Math.floor((elapsed % 1000) / 10);

    this.displayElement.innerText = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}`;

    this.animationFrameId = requestAnimationFrame(this.update);
  };
}
