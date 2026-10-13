-- Path of Building
--
-- Module: Language/ko/Init
-- Korean translation layer. Translates text at draw time, so builds, items and saved data stay in English
-- and remain fully compatible with the regular Path of Building.
--
-- Dictionaries (all optional, each returns { exact = { }, templates = { } }):
--   Language/ko/UI.lua           hand written translations of Path of Building's own interface
--   Language/ko/Generated/*.lua  generated from the official Korean game data by tools/ko/build
--
-- exact:     [english text] = korean text
-- templates: [english text with numbers replaced by #] = korean text with {1}, {2}... for the numbers in order
--

local t_insert = table.insert
local t_concat = table.concat
local t_sort = table.sort
local s_find = string.find
local s_sub = string.sub
local s_gsub = string.gsub
local s_match = string.match

ko = {
	exact = { },
	templates = { },
	-- Set to a table to collect untranslated text (enabled in dev mode); dumped to Language/ko/missing.txt on exit
	missing = nil,
	missingCount = 0,
}

local GENERATED = { "Data", "Mods" }
local CACHE_LIMIT = 20000
local MISSING_LIMIT = 50000

local function fileExists(path)
	local file = io.open(path, "r")
	if file then
		file:close()
		return true
	end
	return false
end

local function loadDictionary(name)
	local path = "Language/ko/" .. name .. ".lua"
	if not fileExists(path) then
		return
	end
	local dict = LoadModule(path)
	for en, kr in pairs(dict.exact or { }) do
		ko.exact[en] = kr
	end
	for en, kr in pairs(dict.templates or { }) do
		ko.templates[en] = kr
	end
end

for _, name in ipairs(GENERATED) do
	loadDictionary("Generated/" .. name)
end
-- Hand written entries override generated ones
loadDictionary("UI")

-- Replaces numbers (and ranges such as "(10-20)") with "#", returning the key and the replaced values in order
local function normalize(text)
	local out, values = { }, { }
	local pos, len = 1, #text
	local plainStart = 1
	while pos <= len do
		local _, rangeEnd = s_find(text, "^[%+%-]?%(%-?%d+%.?%d*%-%-?%d+%.?%d*%)", pos)
		local _, numEnd = s_find(text, "^[%+%-]?%d[%d,]*%.?%d*", pos)
		local tokenEnd = rangeEnd or numEnd
		-- Only treat it as a number at a word boundary, so identifiers like "x2" are left alone
		if tokenEnd and (pos == 1 or not s_find(s_sub(text, pos - 1, pos - 1), "[%w_]")) then
			t_insert(out, s_sub(text, plainStart, pos - 1))
			t_insert(out, "#")
			t_insert(values, s_sub(text, pos, tokenEnd))
			pos = tokenEnd + 1
			plainStart = pos
		else
			pos = pos + 1
		end
	end
	if #values == 0 then
		return nil
	end
	t_insert(out, s_sub(text, plainStart))
	return t_concat(out), values
end

local function recordMissing(text)
	if not ko.missing or ko.missingCount >= MISSING_LIMIT or #text > 300 then
		return
	end
	local key = normalize(text) or text
	if not ko.missing[key] then
		ko.missingCount = ko.missingCount + 1
		ko.missing[key] = 0
	end
	ko.missing[key] = ko.missing[key] + 1
end

-- Translates one piece of text that contains no colour codes or line breaks
local function translateSegment(segment)
	if not s_find(segment, "%a") then
		return segment
	end
	local lead, core, trail = s_match(segment, "^(%s*)(.-)(%s*)$")
	local kr = ko.exact[core]
	if not kr then
		-- "Label:" style text
		local label = s_match(core, "^(.-):$")
		if label and ko.exact[label] then
			kr = ko.exact[label] .. ":"
		end
	end
	if not kr then
		local key, values = normalize(core)
		local template = key and ko.templates[key]
		if template then
			kr = s_gsub(template, "{(%d+)}", function(idx)
				return values[tonumber(idx)] or ""
			end)
		end
	end
	if kr then
		return lead .. kr .. trail
	end
	recordMissing(core)
	return segment
end

-- Splits a line on colour codes (^0-^9 and ^xRRGGBB) and translates the text between them
local function translateLine(line)
	if ko.exact[line] then
		return ko.exact[line]
	end
	local out = { }
	local pos, len = 1, #line
	local textStart = 1
	while pos <= len do
		local codeEnd
		if s_sub(line, pos, pos) == "^" then
			codeEnd = select(2, s_find(line, "^%^x%x%x%x%x%x%x", pos)) or select(2, s_find(line, "^%^%d", pos))
		end
		if codeEnd then
			if pos > textStart then
				t_insert(out, translateSegment(s_sub(line, textStart, pos - 1)))
			end
			t_insert(out, s_sub(line, pos, codeEnd))
			pos = codeEnd + 1
			textStart = pos
		else
			pos = pos + 1
		end
	end
	if textStart <= len then
		t_insert(out, translateSegment(s_sub(line, textStart)))
	end
	return t_concat(out)
end

local cache, cacheSize = { }, 0

function ko.Translate(text)
	if type(text) ~= "string" or text == "" then
		return text
	end
	local result = cache[text]
	if result then
		return result
	end
	if s_find(text, "\n", 1, true) then
		local lines = { }
		for line in (text .. "\n"):gmatch("(.-)\n") do
			t_insert(lines, translateLine(line))
		end
		result = t_concat(lines, "\n")
	else
		result = translateLine(text)
	end
	if cacheSize >= CACHE_LIMIT then
		cache, cacheSize = { }, 0
	end
	cache[text] = result
	cacheSize = cacheSize + 1
	return result
end

-- While > 0, text is drawn untranslated (used for user editable text)
local suppress = 0

function ko.WithoutTranslation(func, ...)
	suppress = suppress + 1
	local results = { pcall(func, ...) }
	suppress = suppress - 1
	if not results[1] then
		error(results[2], 0)
	end
	return unpack(results, 2, table.maxn(results))
end

local engineDrawString = DrawString
local engineDrawStringWidth = DrawStringWidth

function DrawString(left, top, align, height, font, text)
	if suppress == 0 then
		text = ko.Translate(text)
	end
	return engineDrawString(left, top, align, height, font, text)
end

function DrawStringWidth(height, font, text)
	if suppress == 0 then
		text = ko.Translate(text)
	end
	return engineDrawStringWidth(height, font, text)
end
-- DrawStringCursorIndex is deliberately left alone: callers use the returned index to cut the original string.

-- Class hooks, applied right after the class file is loaded
local classHooks = { }

function ko.HookClass(className, func)
	classHooks[className] = func
end

local engineLoadModule = LoadModule

function LoadModule(name, ...)
	local results = { engineLoadModule(name, ...) }
	local className = s_match(name, "^Classes/([%w_]+)")
	local hook = className and classHooks[className]
	if hook and common and common.classes[className] then
		classHooks[className] = nil
		hook(common.classes[className])
	end
	return unpack(results, 1, table.maxn(results))
end

-- Edit boxes show user text: keep their contents untranslated but translate the prompt and placeholder
ko.HookClass("EditControl", function(class)
	for key, func in pairs(class) do
		if type(func) == "function" and not s_find(key, "^_") and key ~= "EditControl" then
			class[key] = function(self, ...)
				local prompt, placeholder = self.prompt, self.placeholder
				local krPrompt, krPlaceholder = ko.Translate(prompt), ko.Translate(placeholder)
				self.prompt, self.placeholder = krPrompt, krPlaceholder
				local results = { pcall(ko.WithoutTranslation, func, self, ...) }
				-- Restore the originals unless the method assigned new values itself (e.g. SetPlaceholder)
				if self.prompt == krPrompt then
					self.prompt = prompt
				end
				if self.placeholder == krPlaceholder then
					self.placeholder = placeholder
				end
				if not results[1] then
					error(results[2], 0)
				end
				return unpack(results, 2, table.maxn(results))
			end
		end
	end
end)

function ko.DumpMissing()
	if not ko.missing or ko.missingCount == 0 then
		return
	end
	local list = { }
	for text, count in pairs(ko.missing) do
		t_insert(list, { text = text, count = count })
	end
	t_sort(list, function(a, b)
		if a.count ~= b.count then
			return a.count > b.count
		end
		return a.text < b.text
	end)
	local file = io.open("Language/ko/missing.txt", "w")
	if file then
		for _, entry in ipairs(list) do
			file:write(entry.count, "\t", entry.text, "\n")
		end
		file:close()
	end
end

function ko.AttachLaunch(launch)
	local onInit = launch.OnInit
	function launch:OnInit(...)
		onInit(self, ...)
		if self.devMode then
			ko.missing = { }
		end
	end
	local onExit = launch.OnExit
	function launch:OnExit(...)
		onExit(self, ...)
		ko.DumpMissing()
	end
end
