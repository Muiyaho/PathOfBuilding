-- Tests for the Korean translation layer. Run from the src directory: luajit ../tools/ko/test.lua

-- Minimal stand-ins for the SimpleGraphic functions used by Language/ko/Init.lua
local drawn
function DrawString(left, top, align, height, font, text) drawn = text end
function DrawStringWidth(height, font, text) return #text end
function LoadModule(name, ...)
	if not name:match("%.lua$") then
		name = name .. ".lua"
	end
	return assert(loadfile(name))(...)
end

local startTime = os.clock()
LoadModule("Language/ko/Init")
print(string.format("Dictionaries loaded in %.2fs", os.clock() - startTime))

local failures = 0
local function check(input, expected)
	local actual = ko.Translate(input)
	if actual ~= expected then
		failures = failures + 1
		print(string.format("FAIL\n  input:    %q\n  expected: %q\n  actual:   %q", input, expected, actual))
	end
end

-- Names from the data tables
check("Fireball", "화염구")
check("Added Fire Damage", "화염 피해 추가")
check("Mageblood", "마법사의 피")

-- Mod templates, including signs, ranges and reordered numbers
check("+70 to maximum Life", "생명력 최대치 +70")
check("+(70-89) to maximum Life", "생명력 최대치 +(70-89)")
check("Adds 10 to 20 Fire Damage", "화염 피해 10~20 추가")
check("30% less maximum Life", "최대 생명력 30% 감폭")
check("Regenerate 12.5 Life per second", "1초마다 생명력 12.5 재생")

-- Colour codes, surrounding whitespace and multiple lines
check("^7+70 to maximum Life", "^7생명력 최대치 +70")
check("^x8888FF+70 to maximum Life^7", "^x8888FF생명력 최대치 +70^7")
check("  Fireball  ", "  화염구  ")
check("Fireball\n+70 to maximum Life", "화염구\n생명력 최대치 +70")

-- Untranslated text passes through unchanged
check("Some text that is not in any dictionary", "Some text that is not in any dictionary")
check("12,345.6", "12,345.6")
check("", "")
check(nil, nil)

-- Draw hooks translate, unless suppressed
DrawString(0, 0, "LEFT", 16, "VAR", "Fireball")
assert(drawn == "화염구", "DrawString was not translated")
ko.WithoutTranslation(DrawString, 0, 0, "LEFT", 16, "VAR", "Fireball")
assert(drawn == "Fireball", "DrawString was translated while suppressed")

-- Missing text collection
ko.missing = { }
ko.Translate("Unknown label 42")
assert(ko.missing["Unknown label #"] == 1, "Missing text was not recorded")

-- Rough throughput check: a frame draws a few thousand strings, most of them repeated
startTime = os.clock()
for i = 1, 200000 do
	ko.Translate("+" .. (i % 500) .. " to maximum Life")
end
print(string.format("200k translations in %.2fs", os.clock() - startTime))

if failures > 0 then
	print(failures .. " check(s) failed")
	os.exit(1)
end
print("All checks passed")
