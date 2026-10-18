# デザインガイドのうち、トークンの文書は style-guide が作り、トンマナと部品の使い方は design-studio が作る

デザインガイドは、部品帳・トンマナ・スタイルガイド・テーマの一式である。トークンの文書 (`style-guide.md`) は、style-guide に「Seed から文書も出す」口を足して作らせ、design-studio は手を加えずにそのまま置く。トンマナと部品の使い方は、依頼・方向性の文章・表現を知っている design-studio が LLM で作り、別のファイル (`design-guide.md`) にする。トンマナまで style-guide に作らせると、依頼や表現を style-guide に渡す口が要り、style-guide の役割が「テーマを作る」から広がるためである。1 つの文書に混ぜないのは、style-guide の版が上がったときにトークンの文書だけを作り直せるようにするためである。

## Considered Options

- トークンの文書も design-studio が自前で書く: style-guide の文書と中身が二重になり、片方だけ古くなる
- トンマナも style-guide に作らせる: 上のとおり、style-guide の入力が依頼や表現にまで広がる

## Consequences

- デザインガイドを作るには、文書の口を持つ版の style-guide が要る。古い版のときは部品帳だけを作り、style-guide の更新を案内する
- design-studio の台帳が固定している style-guide の ref を、文書の口を足した版に上げる
