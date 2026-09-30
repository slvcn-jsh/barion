with open('src/components/BariMascot.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

import re
text = re.sub(r'resizeMode=\s*cover', 'resizeMode=\ cover\', text)
text = re.sub(r'accessibilityRole=\s*image', 'accessibilityRole=\image\', text)
text = re.sub(r'accessibilityRole=\s*button', 'accessibilityRole=\button\', text)

with open('src/components/BariMascot.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
print('FIXED')