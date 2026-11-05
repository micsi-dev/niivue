declare module '@niivue/dcm2niix' {
  export class Dcm2niix {
    worker: Worker | null
    init(): Promise<void>
    input(files: File[]): {
      run: () => Promise<File[]>
    }
  }
}
