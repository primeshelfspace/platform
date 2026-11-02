-- Company Profile and Brand Management stories: Theme Color is optional, and
-- a Brand added without one has none (it used to get #2D6A6A silently).
-- Existing brands keep the colour they have. Screens that need a colour fall
-- back to DEFAULT_BRAND_THEME_COLOR when it is null.
ALTER TABLE brand ALTER COLUMN theme_color DROP DEFAULT;
ALTER TABLE brand ALTER COLUMN theme_color DROP NOT NULL;
