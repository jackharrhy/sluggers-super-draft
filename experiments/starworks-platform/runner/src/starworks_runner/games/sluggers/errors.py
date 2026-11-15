"""Expected, operator-actionable failures from the Sluggers adapter."""


class SluggersAdapterError(RuntimeError):
    """Base class for a fail-closed adapter operation."""


class ToolVerificationError(SluggersAdapterError):
    """A required external tool does not match its pinned release."""


class DiscImageError(SluggersAdapterError):
    """A disc image could not be identified, verified, or extracted safely."""


class UnsupportedBaseError(SluggersAdapterError):
    """The extracted game does not match a reviewed supported base."""


class BuildIntegrityError(SluggersAdapterError):
    """A build or cache artifact failed an integrity check."""


class DolphinLaunchError(SluggersAdapterError):
    """Dolphin could not be verified or launched safely."""
