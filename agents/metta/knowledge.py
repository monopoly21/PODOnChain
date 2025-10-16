from __future__ import annotations

import logging
from functools import lru_cache
from typing import Iterable

from hyperon import E, MeTTa, S, ValueAtom

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_metta() -> MeTTa:
  """Return a shared MeTTa interpreter instance."""
  return MeTTa()


def load_domain_knowledge(
  metta: MeTTa | None = None, atoms: Iterable[tuple[str, str, str | int | float]] | None = None
) -> None:
  """
  Load baseline domain knowledge into the provided MeTTa instance.

  Parameters
  ----------
  metta:
      Optional MeTTa instance; defaults to the shared interpreter.
  atoms:
      Optional iterable of (relation, subject, object) triples to preload.
  """
  engine = metta or get_metta()
  if atoms:
    for relation, subject, obj in atoms:
      value = ValueAtom(obj) if isinstance(obj, (int, float)) else S(str(obj))
      engine.space().add_atom(E(S(relation), S(subject), value))
      logger.debug("Loaded atom (%s %s %s)", relation, subject, obj)
