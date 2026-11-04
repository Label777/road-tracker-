# Road Tracker

Нативное iOS-приложение для учёта поездок на работу и обратно: время, расходы в гривнах, пересадки, контролёры, GPS и автоопределение поездок, облачная синхронизация через Supabase.

Аудит, ограничения iOS, архитектура и план этапов — в [docs/AUDIT_AND_PLAN.md](docs/AUDIT_AND_PLAN.md).

## Быстрый старт (Mac)

```bash
brew install xcodegen supabase/tap/supabase
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig   # вписать URL и anon key
xcodegen generate
open RoadTracker.xcodeproj
```

Без `Secrets.xcconfig` приложение работает полностью локально, синхронизация показывает «Облако не настроено».

## Supabase

```bash
supabase link --project-ref <ref>
supabase db push            # применит supabase/migrations
```

В приложение кладётся только публичный anon/publishable key. Secret / service_role key — никогда.

## Тесты

```bash
# Доменное ядро (macOS или Linux со Swift 6)
cd Packages/RoadTrackerCore && swift test

# Схема БД, RLS, ограничения — на временном PostgreSQL 15+
supabase/tests/run_local.sh

# Приложение + SwiftData: Xcode → Product → Test (⌘U)
```

## Структура

```
RoadTracker/            iOS-приложение (SwiftUI, SwiftData)
Packages/RoadTrackerCore  доменная логика без зависимостей от iOS
RoadTrackerTests/       интеграционные тесты локальной базы
supabase/               миграции и тесты схемы
Config/                 xcconfig (секреты не в git)
docs/                   аудит и план
```
