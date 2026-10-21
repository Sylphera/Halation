use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};

pub const PROFILE_DIR_NAME: &str = "slint-beta";
pub const PROFILE_ENV: &str = "HALATION_SLINT_PROFILE";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchOptions {
    pub profile_root: Option<PathBuf>,
    pub diagnostic_scene: Option<DiagnosticScene>,
    pub print_version: bool,
    pub print_profile: bool,
    pub help: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticScene {
    Empty,
    Home,
    Cycle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileError {
    UnknownArgument(String),
    InvalidDiagnosticScene(String),
    MissingValue(String),
    EmptyPath,
    NoLocalAppData,
}

impl fmt::Display for ProfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownArgument(arg) => write!(f, "unknown argument: {arg}"),
            Self::InvalidDiagnosticScene(scene) => write!(
                f,
                "invalid diagnostic scene '{scene}'; expected empty, home, or cycle"
            ),
            Self::MissingValue(arg) => write!(f, "missing value after {arg}"),
            Self::EmptyPath => write!(f, "profile root cannot be empty"),
            Self::NoLocalAppData => {
                write!(
                    f,
                    "LOCALAPPDATA is not set; pass --profile-root <directory>"
                )
            }
        }
    }
}

impl std::error::Error for ProfileError {}

/// Parse only the arguments after the executable name.
pub fn parse_args<I>(args: I) -> Result<LaunchOptions, ProfileError>
where
    I: IntoIterator<Item = String>,
{
    let mut options = LaunchOptions::default();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--version" | "-V" => options.print_version = true,
            "--print-profile" => options.print_profile = true,
            "--help" | "-h" => options.help = true,
            "--diagnostic-scene" => {
                let value = args.next().ok_or(ProfileError::MissingValue(arg))?;
                options.diagnostic_scene = Some(parse_diagnostic_scene(&value)?);
            }
            "--profile-root" => {
                let value = args.next().ok_or(ProfileError::MissingValue(arg))?;
                if value.trim().is_empty() {
                    return Err(ProfileError::EmptyPath);
                }
                options.profile_root = Some(PathBuf::from(value));
            }
            _ => {
                if let Some(value) = arg.strip_prefix("--profile-root=") {
                    if value.trim().is_empty() {
                        return Err(ProfileError::EmptyPath);
                    }
                    options.profile_root = Some(PathBuf::from(value));
                } else if let Some(value) = arg.strip_prefix("--diagnostic-scene=") {
                    options.diagnostic_scene = Some(parse_diagnostic_scene(value)?);
                } else {
                    return Err(ProfileError::UnknownArgument(arg));
                }
            }
        }
    }
    Ok(options)
}

fn parse_diagnostic_scene(value: &str) -> Result<DiagnosticScene, ProfileError> {
    match value {
        "empty" => Ok(DiagnosticScene::Empty),
        "home" => Ok(DiagnosticScene::Home),
        "cycle" => Ok(DiagnosticScene::Cycle),
        _ => Err(ProfileError::InvalidDiagnosticScene(value.to_owned())),
    }
}

/// Resolve the profile root with explicit precedence: CLI, environment, default.
pub fn resolve_root(
    cli: Option<PathBuf>,
    env: Option<OsString>,
    local_app_data: Option<OsString>,
) -> Result<PathBuf, ProfileError> {
    if let Some(path) = cli {
        return Ok(path);
    }
    if let Some(path) = env.filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let base = local_app_data.ok_or(ProfileError::NoLocalAppData)?;
    Ok(PathBuf::from(base).join("Halation").join(PROFILE_DIR_NAME))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    root: PathBuf,
}

impl Profile {
    pub fn at(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn resolve(options: &LaunchOptions) -> Result<Self, ProfileError> {
        let root = resolve_root(
            options.profile_root.clone(),
            std::env::var_os(PROFILE_ENV),
            std::env::var_os("LOCALAPPDATA"),
        )?;
        Ok(Self::at(root))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.root)
    }

    pub fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn library_path(&self) -> PathBuf {
        self.root.join("library.json")
    }

    /// Folder of the user's own Library sections and packs
    pub fn sections_root(&self) -> PathBuf {
        self.root.join("library")
    }

    /// Folders of the PC linked as Library sections
    pub fn links_path(&self) -> PathBuf {
        self.root.join("links.json")
    }

    pub fn log_path(&self) -> PathBuf {
        self.root.join("halation-slint.log")
    }
}
