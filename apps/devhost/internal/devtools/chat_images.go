package devtools

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg" // Register the two explicitly supported native attachment decoders.
	_ "image/png"
	"strings"
)

type chatValidatedImage struct{ dataURL, mediaType, data string }

func validateChatImages(images []chatImage) ([]chatValidatedImage, error) {
	result := make([]chatValidatedImage, 0, len(images))
	total := 0
	for _, attachment := range images {
		total += len(attachment.DataURL)
		if total > chatMessageLimit {
			return nil, fmt.Errorf("image payload exceeds 8 MiB")
		}
		header, data, ok := strings.Cut(attachment.DataURL, ",")
		if !ok {
			return nil, fmt.Errorf("image must be a PNG or JPEG base64 data URL")
		}
		media := ""
		switch header {
		case "data:image/png;base64":
			media = "image/png"
		case "data:image/jpeg;base64":
			media = "image/jpeg"
		default:
			return nil, fmt.Errorf("image must be a PNG or JPEG base64 data URL")
		}
		decoded, err := base64.StdEncoding.Strict().DecodeString(data)
		if err != nil {
			return nil, fmt.Errorf("decode image: %w", err)
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
		if err != nil {
			return nil, fmt.Errorf("read image: %w", err)
		}
		if "image/"+format != media || config.Width <= 0 || config.Height <= 0 {
			return nil, fmt.Errorf("image type does not match its data URL")
		}
		result = append(result, chatValidatedImage{attachment.DataURL, media, data})
	}
	return result, nil
}
