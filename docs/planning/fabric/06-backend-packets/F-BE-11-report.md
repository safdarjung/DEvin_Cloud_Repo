# F-BE-11 report

Files: `src/modules/fabric/demo/simulator.ts`, `tests/unit/fabric-simulator.test.ts`.

Model (paise, linear, pure):
- students = base.students × (1+enrolment%)
- collection% = 97 − 1pt per 5% |fee%| (floor 50)
- revenue = students × fee × (1+fee%) × collection%
- cost = (salaries×(teachers+staff_delta)/teachers + fixed) × (1+cost%); salaries=65% baseline revenue, fixed=remainder of 80% baseline revenue
- utilisation% = students/(rooms×max_per_room)×100
- teacher_load_h = (students/max_per_room)×periods_per_day/(teachers+staff_delta)
- confidence band = ±(5+2×(horizon_months−1))%
- risk_flags: utilisation>95, load>28h, margin<5%

Tests: 8/8 pass (determinism, enrolment+10%, staff+5, horizon widens band, 6 sensitivity params, risk at extreme input).
typecheck/lint clean on touched files (unrelated pre-existing errors in other packets' fabric-fixtures/* untouched).
No deps. No git.
