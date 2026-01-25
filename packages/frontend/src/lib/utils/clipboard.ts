/**
 * Copy text to clipboard with fallback for browsers that block the Clipboard API
 * (e.g., Brave with Shields, non-HTTPS contexts, etc.)
 *
 * @param text - The text to copy to clipboard
 * @returns true if copy succeeded, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern clipboard API first (requires secure context)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn('Clipboard API failed, trying fallback:', e);
    }
  }

  // Fallback using execCommand (deprecated but widely supported)
  // Works in Brave and other browsers that block the async Clipboard API
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Prevent scrolling to bottom of page
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const success = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (success) {
      return true;
    }
  } catch (e) {
    console.error('Fallback copy failed:', e);
  }

  return false;
}
