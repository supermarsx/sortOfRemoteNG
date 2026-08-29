set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE static)
set(VCPKG_LIBRARY_LINKAGE dynamic)
set(VCPKG_BUILD_TYPE release)

# Match the compile-time behavior of libsqlite3-sys's bundled SQLite build.
# The vcpkg manifest selects its extension features; these flags cover the
# remaining planner, metadata, validation, and memory-management options that
# vcpkg does not expose as port features.
if(PORT STREQUAL "sqlite3")
    set(SORNG_SQLITE_COMPILER_FLAGS " /DSQLITE_DEFAULT_FOREIGN_KEYS=1 /DSQLITE_ENABLE_API_ARMOR /DSQLITE_ENABLE_COLUMN_METADATA /DSQLITE_ENABLE_FTS3_PARENTHESIS /DSQLITE_ENABLE_LOAD_EXTENSION=1 /DSQLITE_ENABLE_MEMORY_MANAGEMENT /DSQLITE_ENABLE_STAT4 /DSQLITE_SOUNDEX /DSQLITE_USE_URI")
    string(APPEND VCPKG_C_FLAGS "${SORNG_SQLITE_COMPILER_FLAGS}")
    # vcpkg-cmake requires C and C++ flags to be set together even though the
    # sqlite3 port itself compiles only C sources.
    string(APPEND VCPKG_CXX_FLAGS "${SORNG_SQLITE_COMPILER_FLAGS}")
endif()
