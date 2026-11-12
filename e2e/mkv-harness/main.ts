import { prepareMovie } from '../../apps/web/lib/movie-prepare';
import { checkMovie } from '../../apps/web/lib/movie-check';
// This harness is served only by the standalone acceptance-test server.
let abort = new AbortController();
const output = document.querySelector('output')!;
document.querySelector('button')!.onclick = () => abort.abort();
document.querySelector('input')!.onchange = async (event) => {
  const file = (event.target as HTMLInputElement).files![0]!;
  abort = new AbortController();
  output.textContent = 'Preparing';
  try {
    const result = await prepareMovie(file, 'acceptance', abort.signal, (message) => output.textContent = message);
    const details = await checkMovie(result.file);
    document.querySelector('video')!.src = URL.createObjectURL(result.file);
    output.textContent = JSON.stringify({ size: result.file.size, name: result.file.name, ...details, poster: null });
  } catch (error) {
    output.textContent = 'Error: ' + (error as Error).message;
  }
};
