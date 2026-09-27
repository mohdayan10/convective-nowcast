import numpy as np

from eval.metrics import Accumulator, contingency, fss_from, fss_parts, scores
from pipeline.units import kgm2_to_vil, vil_to_kgm2


def test_contingency_and_scores():
    obs = np.array([[0, 100], [100, 0]])
    pred = np.array([[100, 100], [0, 0]])
    h, m, f = contingency(pred, obs, 74)
    assert (h, m, f) == (1, 1, 1)
    s = scores(h, m, f)
    assert s["csi"] == 1 / 3 and s["pod"] == 0.5 and s["far"] == 0.5 and s["bias"] == 1.0


def test_perfect_forecast():
    rng = np.random.default_rng(0)
    obs = rng.integers(0, 255, (3, 32, 32)).astype(float)
    acc = Accumulator([16, 133], [74], [1, 5], 3)
    acc.add(obs, obs)
    out = acc.summary(5)
    assert all(c == 1.0 for c in out["by_threshold"]["133"]["csi"])
    assert all(v == 1.0 for v in out["fss"]["74"]["5km"])
    assert out["lead_min"] == [5, 10, 15]


def test_fss_improves_with_scale_for_displaced_feature():
    obs = np.zeros((40, 40)); obs[10:14, 10:14] = 200
    pred = np.roll(obs, 3, axis=1)
    small = fss_from(*fss_parts(pred, obs, 74, 1))
    large = fss_from(*fss_parts(pred, obs, 74, 9))
    assert small < large <= 1.0


def test_vil_units_roundtrip_and_known_points():
    assert vil_to_kgm2(np.array([0, 5, 255])).tolist() == [0, 0, 0]
    x = np.array([20.0, 74.0, 133.0, 219.0])
    np.testing.assert_allclose(kgm2_to_vil(vil_to_kgm2(x)), x, atol=1e-3)
    # 219 is the top SEVIR threshold: ~32 kg/m²
    assert 30 < vil_to_kgm2(np.array([219.0]))[0] < 34
