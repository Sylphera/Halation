#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Page {
    Home,
    Library,
    Jobs,
    Settings,
    Converter,
}

impl Page {
    pub const ALL: [Page; 5] = [
        Page::Home,
        Page::Library,
        Page::Jobs,
        Page::Settings,
        Page::Converter,
    ];

    pub fn index(self) -> i32 {
        match self {
            Self::Home => 0,
            Self::Library => 1,
            Self::Jobs => 2,
            Self::Settings => 3,
            Self::Converter => 4,
        }
    }

    pub fn from_index(index: i32) -> Option<Self> {
        match index {
            0 => Some(Self::Home),
            1 => Some(Self::Library),
            2 => Some(Self::Jobs),
            3 => Some(Self::Settings),
            4 => Some(Self::Converter),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Navigation {
    current: Page,
}

impl Default for Navigation {
    fn default() -> Self {
        Self {
            current: Page::Home,
        }
    }
}

impl Navigation {
    pub fn current(&self) -> Page {
        self.current
    }

    /// Returns `true` only when the page actually changed; same-target requests are a no-op.
    pub fn select(&mut self, page: Page) -> bool {
        if self.current == page {
            false
        } else {
            self.current = page;
            true
        }
    }
}
