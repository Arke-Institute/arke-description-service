#!/bin/bash
# Test script for Description Service DO
# Tests: basic description, child aggregation, custom prompts, editing existing

set -e

API_BASE="https://api.arke.institute"
DESC_SERVICE="https://description.arke.institute"

echo "=========================================="
echo "Description Service Integration Tests"
echo "=========================================="
echo ""

# Helper function to upload content and get CID
upload_content() {
  local content="$1"
  local filename="${2:-content.txt}"
  local result=$(curl -s -X POST "$API_BASE/upload" \
    -F "file=@-;filename=$filename" <<< "$content")
  echo "$result" | jq -r '.[0].cid'
}

# Helper function to create entity
create_entity() {
  local components="$1"
  local parent_pi="${2:-}"
  local children_pi="${3:-}"

  local body="{\"components\": $components"
  if [ -n "$parent_pi" ]; then
    body="$body, \"parent_pi\": \"$parent_pi\""
  fi
  if [ -n "$children_pi" ]; then
    body="$body, \"children_pi\": $children_pi"
  fi
  body="$body, \"note\": \"Test entity for description service\"}"

  curl -s -X POST "$API_BASE/entities" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# Helper function to get entity
get_entity() {
  local pi="$1"
  curl -s "$API_BASE/entities/$pi"
}

echo "=== TEST 1: Basic Description Generation ==="
echo ""
echo "Creating test content (Book of Genesis excerpt)..."

# Test content - Public domain Bible text
GENESIS_TEXT="Genesis 1:1-10

In the beginning God created the heaven and the earth.

And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.

And God said, Let there be light: and there was light.

And God saw the light, that it was good: and God divided the light from the darkness.

And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.

And God said, Let there be a firmament in the midst of the waters, and let it divide the waters from the waters.

And God made the firmament, and divided the waters which were under the firmament from the waters which were above the firmament: and it was so.

And God called the firmament Heaven. And the evening and the morning were the second day.

And God said, Let the waters under the heaven be gathered together unto one place, and let the dry land appear: and it was so.

And God called the dry land Earth; and the gathering together of the waters called he Seas: and God saw that it was good."

# Upload content
echo "Uploading Genesis text..."
GENESIS_CID=$(upload_content "$GENESIS_TEXT" "genesis-excerpt.txt")
echo "  Uploaded CID: $GENESIS_CID"

# Create entity with the content
echo "Creating entity..."
ENTITY1_RESULT=$(create_entity "{\"genesis-excerpt.txt\": \"$GENESIS_CID\"}")
ENTITY1_PI=$(echo "$ENTITY1_RESULT" | jq -r '.pi')
ENTITY1_TIP=$(echo "$ENTITY1_RESULT" | jq -r '.tip')
echo "  Created entity: $ENTITY1_PI (tip: $ENTITY1_TIP)"

echo ""
echo "Calling description service..."
BATCH_ID="test_$(date +%s)"
CHUNK_ID="0"

# Call description service
PROCESS_RESULT=$(curl -s -X POST "$DESC_SERVICE/process" \
  -H "Content-Type: application/json" \
  -d "{
    \"batch_id\": \"$BATCH_ID\",
    \"chunk_id\": \"$CHUNK_ID\",
    \"callback_url\": \"https://httpbin.org/post\",
    \"r2_prefix\": \"test/\",
    \"pis\": [{\"pi\": \"$ENTITY1_PI\", \"current_tip\": \"$ENTITY1_TIP\"}]
  }")

echo "Process result: $PROCESS_RESULT"

# Poll for completion
echo ""
echo "Polling for completion..."
for i in {1..60}; do
  sleep 2
  STATUS=$(curl -s "$DESC_SERVICE/status/$BATCH_ID/$CHUNK_ID")
  PHASE=$(echo "$STATUS" | jq -r '.phase')
  echo "  [$i] Phase: $PHASE"

  if [ "$PHASE" == "DONE" ] || [ "$PHASE" == "ERROR" ]; then
    break
  fi
done

# Check the entity for the description
echo ""
echo "Fetching updated entity..."
UPDATED_ENTITY=$(get_entity "$ENTITY1_PI")
echo "$UPDATED_ENTITY" | jq '.'

# Check if description.md was added
DESC_CID=$(echo "$UPDATED_ENTITY" | jq -r '.components["description.md"] // empty')
if [ -n "$DESC_CID" ]; then
  echo ""
  echo "=== GENERATED DESCRIPTION ==="
  curl -s "$API_BASE/cat/$DESC_CID"
  echo ""
  echo "=== END DESCRIPTION ==="
else
  echo "ERROR: No description.md found in entity!"
fi

echo ""
echo "TEST 1 COMPLETE"
echo ""

# Save the PI for later tests
echo "ENTITY1_PI=$ENTITY1_PI" > /tmp/desc_test_entities.env
