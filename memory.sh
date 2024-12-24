#!/bin/bash

# Description: This script lists all .js files in the ./src folder (recursively),
# excluding any within node_modules directories, concatenates their contents,
# and copies the result to the macOS clipboard while logging each file being processed.

# Create a temporary file to store concatenated content
temp_file=$(mktemp)

# Ensure the temporary file was created successfully
if [[ ! "$temp_file" ]]; then
    echo "Failed to create a temporary file."
    exit 1
fi

# Function to clean up the temporary file on exit
cleanup() {
    rm -f "$temp_file"
}
trap cleanup EXIT

echo "Starting to list and concatenate .js files in ./src (excluding node_modules)..."

# Use find to locate all .js files, excluding node_modules, and process them one by one
find ./ \
    -path "*/node_modules/*" -prune -o \
    -type f -name "*.js" -print0 | while IFS= read -r -d '' file; do
        echo "Processing: $file"
        cat "$file" >> "$temp_file"
done

# Check if concatenation was successful
if [[ $? -ne 0 ]]; then
    echo "An error occurred during file concatenation."
    exit 1
fi

# Copy the concatenated content to the clipboard
if cat "$temp_file" | pbcopy; then
    echo "All file contents have been copied to the clipboard!"
else
    echo "Failed to copy content to the clipboard."
    exit 1
fi
