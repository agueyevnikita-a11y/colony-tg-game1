# COLONY — Economy v0.2

## Неизменные ограничения
Stars не конвертируются напрямую в руду, энергию, детали, кредиты или кристаллы.

Premium:
- +5% passive production;
- +5% build speed;
- 10h offline cap вместо 8h;
- 3 build slots вместо 2.

## Кристаллы
Regular maximum from quests:
- daily: 15/day;
- weekly: 75/week;
- theoretical full week: 180/week.

Premium: 1200 💎 / 30d.

Базовый путь только через задания: ~6.7 недели. Достижения и будущие free-season rewards должны довести активного игрока до 4–6 недель.

## NPC contracts
Контракт расходует ресурс и создаёт кредиты.

Ore contract approximation:
- amount ≈ 220 + 80×HQ + random(0..99);
- reward multiplier ≈ 2.7 + 0.12×HQ.

Parts contract approximation:
- amount ≈ 35 + 15×HQ + random(0..19);
- reward/unit ≈ 18 + 1.5×HQ.

Ограничение предложения: максимум 3 созданных контракта / 6 часов / игрок.

## Причина не включать P2P в v0.2
До реального теста неизвестны:
- медианный запас ресурсов;
- доля времени на storage cap;
- фактическая частота плавок;
- сколько credits игроки готовы сжигать;
- насколько NPC-контракты меняют соотношение credits/resources.

P2P до этих данных может закрепить ошибочную цену и создать инфляцию.

## Метрики для решения о P2P
Собираем минимум 7 дней:
- median ore/energy/parts/credits by HQ;
- median storage fullness;
- production vs consumption per resource;
- contracts offered/completed;
- average contract completion latency;
- number of foundry jobs/day;
- daily credits created by passive vs contracts;
- Premium/Free economic delta.

## Критерий баланса Premium
При одинаковой активности Premium-игрок должен развиваться немного комфортнее, но не перескакивать заметно выше Free за счёт денег. Если economic delta начинает определять рейтинг, бонусы Premium уменьшаются.
