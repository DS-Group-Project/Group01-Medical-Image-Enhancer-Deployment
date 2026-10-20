import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, models, transforms
from torch.utils.data import DataLoader
import os

# ==============================================================================
# PHASE 2: Custom Lightweight Vision Model Training Pipeline
# ==============================================================================
# This script is a template to train your own custom CNN (MobileNetV3) for 
# medical body part classification and fracture detection. 
# It is extremely lightweight, fast, and will bypass the need for an LLM API.
#
# INSTRUCTIONS:
# 1. Create a dataset folder with subfolders for each class (e.g. data/chest, data/hand)
# 2. Install requirements: pip install torch torchvision
# 3. Run: python train_custom_vision.py
# ==============================================================================

DATA_DIR = "./data" # Replace with your dataset path
BATCH_SIZE = 32
NUM_EPOCHS = 10
LEARNING_RATE = 0.001

def get_data_loaders():
    data_transforms = {
        'train': transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(10),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ]),
        'val': transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ]),
    }

    if not os.path.exists(DATA_DIR):
        print(f"Error: {DATA_DIR} not found. Please create it and add your images.")
        return None, None, None

    image_datasets = {x: datasets.ImageFolder(os.path.join(DATA_DIR, x), data_transforms[x]) for x in ['train', 'val']}
    dataloaders = {x: DataLoader(image_datasets[x], batch_size=BATCH_SIZE, shuffle=True, num_workers=4) for x in ['train', 'val']}
    class_names = image_datasets['train'].classes
    return dataloaders, class_names

def build_model(num_classes):
    # MobileNetV3 is an industry standard lightweight model. Perfect for fast CPU inference.
    model = models.mobilenet_v3_small(pretrained=True)
    
    # Freeze early layers if you have a small dataset
    for param in model.parameters():
        param.requires_grad = False
        
    # Replace the final classification head
    num_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(num_features, num_classes)
    return model

def train_model():
    dataloaders, class_names = get_data_loaders()
    if not dataloaders: return
    
    print(f"Classes found: {class_names}")
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    
    model = build_model(len(class_names)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.classifier[-1].parameters(), lr=LEARNING_RATE)

    for epoch in range(NUM_EPOCHS):
        print(f'Epoch {epoch}/{NUM_EPOCHS - 1}')
        print('-' * 10)

        for phase in ['train', 'val']:
            if phase == 'train':
                model.train()
            else:
                model.eval()

            running_loss = 0.0
            running_corrects = 0

            for inputs, labels in dataloaders[phase]:
                inputs = inputs.to(device)
                labels = labels.to(device)

                optimizer.zero_grad()
                with torch.set_grad_enabled(phase == 'train'):
                    outputs = model(inputs)
                    _, preds = torch.max(outputs, 1)
                    loss = criterion(outputs, labels)

                    if phase == 'train':
                        loss.backward()
                        optimizer.step()

                running_loss += loss.item() * inputs.size(0)
                running_corrects += torch.sum(preds == labels.data)

            epoch_loss = running_loss / len(dataloaders[phase].dataset)
            epoch_acc = running_corrects.double() / len(dataloaders[phase].dataset)
            print(f'{phase} Loss: {epoch_loss:.4f} Acc: {epoch_acc:.4f}')

    # Save the custom model!
    torch.save(model.state_dict(), 'custom_medical_vision.pth')
    print("Model saved to custom_medical_vision.pth")
    print("You can now load this model in worker.py to replace the LLM API call!")

if __name__ == '__main__':
    train_model()
