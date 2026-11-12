# Озвучка текста

Английская речь в браузере: модель Kokoro-82M через `kokoro-js` (WebGPU, иначе WASM). WAV сохраняется локально, сервер и аккаунт не нужны.

Запуск: `npm install`, затем `npm run dev`.

GitHub Pages: в репозитории Settings → Pages → Source выберите GitHub Actions. Пуш в `master` запускает `.github/workflows/pages.yml`: сборка `dist` и публикация на `https://max-im.github.io/text-to-speech/`. Cloudflare Pages: команда `npm run build`, каталог `dist`.

Первый запуск один раз скачивает модель с Hugging Face (около 90 МБ на процессоре, около 330 МБ на видеокарте) и оставляет её в кэше браузера.
