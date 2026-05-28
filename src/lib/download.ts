export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Defer revoke so Safari has time to start the download (Chrome/Firefox
  // are fine immediately, but the spec doesn't guarantee it).
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
