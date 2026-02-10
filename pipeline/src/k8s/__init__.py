"""K8s API Pipeline - Fetch and parse Kubernetes OpenAPI specs.

Reorganized structure:
- core/     - Config and models
- input/    - Data fetching and staging
- transform/ - Parsing and building
- output/   - JSON and Parquet export
"""

__version__ = "0.1.0"

# Re-export for backward compatibility (explicit re-exports for ruff F401)
from .core.config import (
    CACHE_DIR as CACHE_DIR,
)
from .core.config import (
    CLUSTER_SCOPED_KINDS as CLUSTER_SCOPED_KINDS,
)
from .core.config import (
    DATA_ROOT as DATA_ROOT,
)
from .core.config import (
    GROUP_COLORS as GROUP_COLORS,
)
from .core.config import (
    GROUP_DISPLAY_NAMES as GROUP_DISPLAY_NAMES,
)
from .core.config import (
    K8S_VERSIONS as K8S_VERSIONS,
)
from .core.config import (
    KIND_DOCS_URLS as KIND_DOCS_URLS,
)
from .core.config import (
    OPENAPI_URL_TEMPLATE as OPENAPI_URL_TEMPLATE,
)
from .core.config import (
    OUTPUT_DIR as OUTPUT_DIR,
)
from .core.config import (
    PIPELINE_DATA_DIR as PIPELINE_DATA_DIR,
)
from .core.config import (
    PIPELINE_ROOT as PIPELINE_ROOT,
)
from .core.config import (
    REPO_ROOT as REPO_ROOT,
)
from .core.config import (
    REPOS_DIR as REPOS_DIR,
)
from .core.models import (
    APIGroup as APIGroup,
)
from .core.models import (
    APITree as APITree,
)
from .core.models import (
    APIVersion as APIVersion,
)
from .core.models import (
    Kind as Kind,
)
from .core.models import (
    KindSchema as KindSchema,
)
from .core.models import (
    Relationship as Relationship,
)
from .core.models import (
    SchemaProperty as SchemaProperty,
)
from .core.models import (
    VersionInfo as VersionInfo,
)
