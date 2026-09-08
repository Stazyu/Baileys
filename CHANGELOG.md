# @stazyu/baileys fork

## 0.3.0 (2026-09-08)

- feat(socket): add `sendRichHtml` and RichText message generation
- feat(socket): add GenAI interactive HTML and Markdown link/citation/inline-LaTeX rendering (`sendMarkdown`, `sendRichHtml`)
- feat(utils): add GenAI inline entities (`extractIE`, `normalizeRichHtmlArgs`, `generateRichHtmlContent`) for hyperlink/citation/latex rendering
- feat(voip): add VoIP video call support (`videoSource`, `isVideo`, `videoLoop`/`repeatVideo`, `videoOrientation`, plus `videoStarted`/`videoEnded`/`videoError` events) backed by a new `video-feeder`
- feat(voip): rework wasm engine, signaling, audio feeder, and relay transport for video
- deps: bump `link-preview-js` from ^3 to ^4.0.4
- chore: regenerate WAProto bindings for WhatsApp 2.3000.1046900546

## 0.2.1 (2026-08-15)

- fix: bump version and update README

## 0.2.0 (2026-08-15)

- feat(socket): add sticker pack message support
- feat(media): improve sticker pack message generation
- docs: add sticker pack documentation

## 0.1.0 (2026-08-15)

- feat: port baileys-innovators additive features
- feat: publish under `@stazyu/baileys` and adjust package naming
- feat: update NPM publish process
- fix: advertise `WIN_HYBRID` instead of retired WIN32 web sub-platform (#2741)



