# Privacy

## Local processing

The images, video and audio you open in Halation are processed locally on your PC. Halation does not require an account, login or cloud processing service. Its editing, AI enhancement and export tools use local engines and models.

## When Halation connects to the internet

Some features use the network when you use them:

- **Downloader and URL analysis** contact the relevant services to read metadata, find matching media and download video, audio or artwork. This can include Spotify or Apple metadata and YouTube searches.
- **Profile discovery and Cover Test** query public profiles, reference artists, feeds and images from services such as YouTube, Spotify and SoundCloud. Profile discovery can also query search providers and MusicBrainz, including during onboarding. When opened, Cover Test may refresh saved profiles, references and feeds.
- **Updates**: a few seconds after it starts (unless turned off in Settings → About → Updates) and when you choose Check for updates, Halation reads `latest.json` from its public GitHub releases. Updating downloads the signed setup from the same releases. GitHub receives the request and your network IP address.
- **Optional components** are downloaded when a feature needs them or you install them through Settings. Engines and models come from their upstream hosts, including GitHub, jsDelivr and NuGet. Once installed, they process your media locally. Vocal Remover runs on the GPU through Microsoft DirectML, a Windows component whose own license says it may collect diagnostic data and send it to Microsoft under Microsoft's privacy statement.

## Third-party services

When you use an online feature, the external service receives the information needed for the request, such as a URL, search term, profile identifier and your network IP address. Pages loaded from an external service may also make their own requests. Those services handle this information under their own privacy policies.

## Analytics and local data

Halation does not include its own analytics or advertising telemetry.

Settings, project data, recent-file information and cached profile data are stored locally in Halation's workspace. This local storage helps restore your work and reuse previously fetched information.
