"""Tier-aware multi-output U-Net (brief M5).

Input:  13 frames × (VIL, IR069, IR107, lightning) + tier map + radar mask → 54 channels
Output: two heads, n_out future frames each —
        VIL (normalised 0-1, sigmoid) and lightning density (log1p, softplus).
Dropout stays active at inference for the MC-dropout ensemble.
"""
from __future__ import annotations

import torch
from torch import nn


class Block(nn.Module):
    def __init__(self, cin: int, cout: int, p_drop: float = 0.0):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.GroupNorm(8, cout), nn.SiLU(),
            nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.GroupNorm(8, cout), nn.SiLU(),
            nn.Dropout2d(p_drop) if p_drop else nn.Identity(),
        )

    def forward(self, x):
        return self.net(x)


class TierUNet(nn.Module):
    def __init__(self, n_in: int = 13, n_ch: int = 4, n_out: int = 12, base: int = 32, p_drop: float = 0.1):
        super().__init__()
        cin = n_in * n_ch + 2
        c = [base, base * 2, base * 4, base * 8]
        self.enc = nn.ModuleList([Block(cin, c[0]), Block(c[0], c[1]), Block(c[1], c[2]), Block(c[2], c[3], p_drop)])
        self.pool = nn.MaxPool2d(2)
        self.mid = Block(c[3], c[3], p_drop)
        self.up = nn.ModuleList([nn.ConvTranspose2d(c[i], c[i - 1] if i else c[0], 2, stride=2) for i in (3, 2, 1)])
        self.dec = nn.ModuleList([Block(c[2] * 2, c[2], p_drop), Block(c[1] * 2, c[1], p_drop), Block(c[0] * 2, c[0])])
        self.head_vil = nn.Conv2d(c[0], n_out, 1)
        self.head_lght = nn.Conv2d(c[0], n_out, 1)
        self.n_out = n_out

    def forward(self, x):
        skips = []
        for i, blk in enumerate(self.enc):
            x = blk(x)
            if i < 3:
                skips.append(x)
                x = self.pool(x)
        x = self.mid(x)
        for up, dec in zip(self.up, self.dec):
            x = up(x)
            x = dec(torch.cat([x, skips.pop()], dim=1))
        return torch.sigmoid(self.head_vil(x)), nn.functional.softplus(self.head_lght(x))


def n_params(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters())


def mc_dropout(model: nn.Module, x: torch.Tensor, n: int = 10):
    """Stack of n stochastic forward passes (dropout on, norm layers unaffected: GroupNorm)."""
    model.eval()
    for m in model.modules():
        if isinstance(m, nn.Dropout2d):
            m.train()
    with torch.no_grad():
        outs = [model(x) for _ in range(n)]
    model.eval()
    return torch.stack([o[0] for o in outs]), torch.stack([o[1] for o in outs])
