# Real avatars for the committee room

The room now loads real 3D characters. Until you paste model URLs it keeps the
built-in stylised figures, so nothing breaks at any point.

---

## 1. Create seven avatars (free, ~10 minutes)

Go to **https://readyplayer.me** and create an avatar for each seat. You can start
from a photo or build one from scratch. Dress them in business attire — the room is
a boardroom.

| Seat | Character | Suggested look |
|---|---|---|
| `chairman` | James Wilson | Older man, grey hair, dark navy suit, red tie |
| `fundamental` | David Harper | Middle-aged man, grey beard, charcoal suit |
| `market` | Sarah Chen | Woman, dark hair tied back, dark blazer |
| `quant` | Marcus Reed | Man, short dark hair, black turtleneck or suit |
| `risk` | Elena Petrova | Woman, blonde, glasses, grey blazer |
| `macro` | Victor Lee | Man, dark hair, navy suit |
| `portfolio` | Alex Morgan | Younger man, brown hair, blue suit |

When the avatar is finished, copy its `.glb` link. It looks like:

```
https://models.readyplayer.me/64f1a2b3c4d5e6f7a8b9c0d1.glb
```

**Append the morph targets** so the lips move with the voice:

```
https://models.readyplayer.me/64f1a2b3c4d5e6f7a8b9c0d1.glb?morphTargets=mouthOpen,mouthSmile
```

---

## 2. Paste the links into the room

Open `public/committee-room-3d.html`, find the block near the top of the script:

```js
const AVATAR_URLS = {
  fundamental: '',
  market:      '',
  quant:       '',
  chairman:    '',
  risk:        '',
  macro:       '',
  portfolio:   ''
};
```

Fill in the URLs:

```js
const AVATAR_URLS = {
  fundamental: 'https://models.readyplayer.me/AAA.glb?morphTargets=mouthOpen,mouthSmile',
  market:      'https://models.readyplayer.me/BBB.glb?morphTargets=mouthOpen,mouthSmile',
  quant:       'https://models.readyplayer.me/CCC.glb?morphTargets=mouthOpen,mouthSmile',
  chairman:    'https://models.readyplayer.me/DDD.glb?morphTargets=mouthOpen,mouthSmile',
  risk:        'https://models.readyplayer.me/EEE.glb?morphTargets=mouthOpen,mouthSmile',
  macro:       'https://models.readyplayer.me/FFF.glb?morphTargets=mouthOpen,mouthSmile',
  portfolio:   'https://models.readyplayer.me/GGG.glb?morphTargets=mouthOpen,mouthSmile'
};
```

Fill them in one at a time if you prefer — seats you leave empty simply keep the
stylised figure, and you can check each avatar as you go.

---

## 3. Recommended: host the models yourself

Loading seven models from an external service on every page view is slow and puts
your room at the mercy of someone else's uptime. Once you are happy with the
avatars:

1. Download each `.glb` file.
2. Put them in `public/avatars/` in the repository.
3. Change the URLs to local paths:

```js
chairman: '/avatars/chairman.glb',
```

Local files are served from your own domain, load faster, and keep working if the
avatar service changes.

---

## What the room does with a real avatar

- **Eye contact** — the head bone tracks the camera while that member is speaking.
- **Lip sync** — the `mouthOpen` morph target is driven by the actual loudness of
  the TTS audio, not a fake rhythm.
- **Fallback** — if a model fails to load, that seat quietly keeps the built-in
  figure and logs a warning. The session never stops.

---

## Performance

Seven avatars are roughly 5–15 MB total. On phones and older laptops this is heavy.
Options if it drags:

- Use half-body avatars (Ready Player Me offers them) — much smaller.
- Serve the models from your own domain with long cache headers.
- Load only the chairman as a real avatar and keep the rest stylised.
