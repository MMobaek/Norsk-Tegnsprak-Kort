import concurrent.futures
import os
import platform
import re
import urllib.request

# 1. Locate Anki's media directory automatically
system = platform.system()
if system == "Windows":
    base_dir = os.path.expandvars(r"%APPDATA%\Anki2")
elif system == "Darwin":
    base_dir = os.path.expanduser("~/Library/Application Support/Anki2")
else:
    base_dir = os.path.expanduser("~/.local/share/Anki2")

profiles = [
    p
    for p in os.listdir(base_dir)
    if os.path.isdir(os.path.join(base_dir, p))
    and p not in ("addons21", "crashpads")
]
profile_name = profiles[0] if profiles else "User 1"
media_dir = os.path.join(base_dir, profile_name, "collection.media")
os.makedirs(media_dir, exist_ok=True)

print(f"Target Anki media directory: {media_dir}")

# 2. Download helper
headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    )
}


def download_clip(url, filename):
    dest = os.path.join(media_dir, filename)
    if not os.path.exists(dest):
        try:
            req = urllib.request.Request(url, headers=headers)
            with (
                urllib.request.urlopen(req, timeout=15) as resp,
                open(dest, "wb") as f,
            ):
                f.write(resp.read())
        except Exception as e:
            return f"Failed {filename}: {e}"
    return None


# 3. Read your exported data and download
input_file = "Norsk_tegnsprak_export.txt"  # Path to your raw export file
output_file = "anki_ready_deck.txt"

tasks = []
deck_rows = []

with open(input_file, "r", encoding="utf-8") as f:
    lines = [l.strip("\r\n") for l in f if l.strip()]

header = lines[0]
data_rows = lines[1:]

for row in data_rows:
    parts = row.split("\t")
    if len(parts) < 2:
        continue
    word = parts[0]
    url = parts[1]
    cat = parts[2] if len(parts) > 2 else ""
    notes = parts[3] if len(parts) > 3 else ""

    filename = url.split("/")[-1]
    tasks.append((url, filename))
    # Anki's native sound/video syntax
    deck_rows.append(f"{word}\t[sound:{filename}]\t{cat}\t{notes}")

print(f"Downloading {len(tasks)} videos...")
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
    futures = [executor.submit(download_clip, u, fn) for u, fn in tasks]
    for future in concurrent.futures.as_completed(futures):
        err = future.result()
        if err:
            print(err)

# 4. Save formatted deck
with open(output_file, "w", encoding="utf-8") as f:
    f.write("Word\tVideo\tCategory\tNotes\n")
    f.write("\n".join(deck_rows))

print(f"\nDone! File '{output_file}' is ready to import.")